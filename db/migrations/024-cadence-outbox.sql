CREATE TABLE app.cadence_publication(
 workspace_id text NOT NULL,id text NOT NULL,cadence_id text NOT NULL,created_by text NOT NULL,
 snapshot jsonb NOT NULL CHECK(pg_column_size(snapshot)<=2097152),revision bigint NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'active' CHECK(state IN('active','paused','completed')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,cadence_id) REFERENCES app.cadence(workspace_id,id)
);
CREATE TABLE app.cadence_enrollment(
 workspace_id text NOT NULL,id text NOT NULL,publication_id text NOT NULL,lead_id text NOT NULL,identity_id text NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN('active','stopped','blocked','completed')),next_step integer NOT NULL DEFAULT 0,
 anchor_at timestamptz NOT NULL,last_accepted_at timestamptz,next_at timestamptz NOT NULL,authorized_reply_epoch bigint NOT NULL,stop_reason text,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,publication_id,lead_id),
 FOREIGN KEY(workspace_id,publication_id) REFERENCES app.cadence_publication(workspace_id,id),
 FOREIGN KEY(workspace_id,lead_id) REFERENCES app.lead(workspace_id,id),FOREIGN KEY(workspace_id,identity_id) REFERENCES app.channel_identity(workspace_id,id)
);
CREATE TABLE app.message_outbox(
 workspace_id text NOT NULL,message_id text NOT NULL,publication_id text,enrollment_id text,step_index integer,
 connection_id text NOT NULL,sender_id text NOT NULL,identity_id text NOT NULL,actor_id text NOT NULL,authority_kind text NOT NULL CHECK(authority_kind IN('admin','member')),
 prepared_send jsonb NOT NULL,proof jsonb NOT NULL DEFAULT '{}',state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','dispatching','accepted','failed','uncertain','cancelled','blocked')),
 next_at timestamptz NOT NULL DEFAULT clock_timestamp(),lease_token text,lease_until timestamptz,fence bigint NOT NULL DEFAULT 0,attempt_count integer NOT NULL DEFAULT 0,
 remote_id text,accepted_at timestamptz,blocked_code text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,message_id),UNIQUE(workspace_id,enrollment_id,step_index),
 FOREIGN KEY(workspace_id,message_id) REFERENCES app.channel_message(workspace_id,id),FOREIGN KEY(workspace_id,publication_id) REFERENCES app.cadence_publication(workspace_id,id),
 FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.cadence_enrollment(workspace_id,id),FOREIGN KEY(workspace_id,connection_id) REFERENCES app.channel_connection(workspace_id,id),
 FOREIGN KEY(workspace_id,sender_id) REFERENCES app.channel_sender(workspace_id,id),FOREIGN KEY(workspace_id,identity_id) REFERENCES app.channel_identity(workspace_id,id)
);
CREATE INDEX message_outbox_due ON app.message_outbox(next_at,created_at) WHERE state='pending';
CREATE TABLE app.message_dispatch_attempt(
 workspace_id text NOT NULL,id text NOT NULL,message_id text NOT NULL,attempt_number integer NOT NULL CHECK(attempt_number BETWEEN 1 AND 3),
 fence bigint NOT NULL,lease_token text NOT NULL,state text NOT NULL CHECK(state IN('prepared','dispatching','accepted','not_accepted','uncertain')),
 remote_id text,outcome jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),started_at timestamptz,completed_at timestamptz,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,message_id,attempt_number),FOREIGN KEY(workspace_id,message_id) REFERENCES app.message_outbox(workspace_id,message_id)
);
CREATE TABLE app.message_usage_ledger(
 workspace_id text NOT NULL,id bigint GENERATED ALWAYS AS IDENTITY,sender_id text NOT NULL,message_id text NOT NULL,attempt_id text,
 event text NOT NULL CHECK(event IN('reserve','release','consume')),operation_id text NOT NULL,units integer NOT NULL DEFAULT 1 CHECK(units>=0 AND units<=1),
 cost_usd numeric CHECK(cost_usd>=0),cost_kind text NOT NULL DEFAULT 'unknown' CHECK(cost_kind IN('unknown','reported')),period_date date NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,operation_id,event),FOREIGN KEY(workspace_id,sender_id) REFERENCES app.channel_sender(workspace_id,id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES app.message_outbox(workspace_id,message_id)
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['cadence_publication','cadence_enrollment','message_outbox','message_dispatch_attempt','message_usage_ledger'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON app.%I FROM cadence_app',t);
  EXECUTE format('CREATE POLICY tenant_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
  EXECUTE format('GRANT SELECT ON app.%I TO cadence_app',t);
 END LOOP;
END $$;
CREATE POLICY admin_insert ON app.cadence_publication FOR INSERT WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND created_by=current_setting('app.user_id',true) AND app.current_role() IN('owner','admin'));
CREATE POLICY admin_insert ON app.cadence_enrollment FOR INSERT WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
GRANT INSERT ON app.cadence_publication,app.cadence_enrollment TO cadence_app;

CREATE FUNCTION app.stop_pending_channel_identity(p_ws text,p_identity text,p_reason text,p_text text DEFAULT '') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e app.cadence_enrollment;p app.cadence_publication;keyword text;
BEGIN
 FOR e IN SELECT * FROM app.cadence_enrollment WHERE workspace_id=p_ws AND identity_id=p_identity AND state IN('active','blocked') FOR UPDATE LOOP
  SELECT * INTO p FROM app.cadence_publication WHERE workspace_id=e.workspace_id AND id=e.publication_id;
  IF p_reason='reply' THEN
   FOR keyword IN SELECT jsonb_array_elements_text(p.snapshot->'cadence'->'settings'->'stopKeywords') LOOP
    IF lower(btrim(keyword))=lower(btrim(p_text)) THEN
     INSERT INTO app.contact_suppression(workspace_id,identity_id,reason) VALUES(p_ws,p_identity,'cadence_keyword') ON CONFLICT DO NOTHING;
    END IF;
   END LOOP;
  END IF;
  IF p_reason='optout' OR COALESCE((p.snapshot->'cadence'->'settings'->>'stopOnReply')::boolean,false) OR COALESCE((p.snapshot->'cadence'->'steps'->e.next_step->>'stopOnReply')::boolean,false) THEN
   UPDATE app.cadence_enrollment SET state='stopped',stop_reason=p_reason WHERE workspace_id=p_ws AND id=e.id;
   UPDATE app.message_outbox SET state='cancelled',blocked_code=upper(p_reason) WHERE workspace_id=p_ws AND enrollment_id=e.id AND state IN('pending','blocked');
   UPDATE app.channel_message SET state='cancelled' WHERE workspace_id=p_ws AND id IN(SELECT message_id FROM app.message_outbox WHERE workspace_id=p_ws AND enrollment_id=e.id AND state='cancelled') AND state IN('pending','blocked');
  END IF;
 END LOOP;
END $$;
CREATE FUNCTION app.channel_inbound_stop_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.direction='inbound' THEN PERFORM app.stop_pending_channel_identity(NEW.workspace_id,NEW.identity_id,'reply',COALESCE(NEW.text,''));END IF;RETURN NEW;
END $$;
CREATE TRIGGER channel_inbound_stop AFTER INSERT ON app.channel_message FOR EACH ROW EXECUTE FUNCTION app.channel_inbound_stop_trigger();
CREATE FUNCTION app.channel_suppression_stop_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.scope IN('all','campaign') THEN PERFORM app.stop_pending_channel_identity(NEW.workspace_id,NEW.identity_id,'optout');END IF;
 UPDATE app.message_outbox SET state='cancelled',blocked_code='CONTACT_SUPPRESSED' WHERE workspace_id=NEW.workspace_id AND identity_id=NEW.identity_id AND state IN('pending','blocked') AND (NEW.scope='all' OR prepared_send->>'purpose'=NEW.scope);
 UPDATE app.channel_message SET state='cancelled' WHERE workspace_id=NEW.workspace_id AND identity_id=NEW.identity_id AND id IN(SELECT message_id FROM app.message_outbox WHERE workspace_id=NEW.workspace_id AND identity_id=NEW.identity_id AND state='cancelled') AND state IN('pending','blocked');RETURN NEW;
END $$;
CREATE TRIGGER channel_suppression_stop AFTER INSERT ON app.contact_suppression FOR EACH ROW EXECUTE FUNCTION app.channel_suppression_stop_trigger();
CREATE FUNCTION app.stop_reviewed_identity(p_identity text,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') OR p_reason NOT IN('reply','optout') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=current_setting('app.workspace_id',true) FOR UPDATE;
 PERFORM app.stop_pending_channel_identity(current_setting('app.workspace_id',true),p_identity,p_reason);
END $$;
CREATE FUNCTION app.pause_cadence_publication(p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 UPDATE app.cadence_publication SET state='paused',revision=revision+1 WHERE workspace_id=ws AND id=p_id;
 UPDATE app.message_outbox SET state='cancelled',blocked_code='PUBLICATION_PAUSED' WHERE workspace_id=ws AND publication_id=p_id AND state IN('pending','blocked');
 UPDATE app.channel_message SET state='cancelled' WHERE workspace_id=ws AND id IN(SELECT message_id FROM app.message_outbox WHERE workspace_id=ws AND publication_id=p_id AND state='cancelled') AND state IN('pending','blocked');
END $$;
REVOKE ALL ON FUNCTION app.stop_pending_channel_identity(text,text,text,text),app.channel_inbound_stop_trigger(),app.channel_suppression_stop_trigger(),app.stop_reviewed_identity(text,text),app.pause_cadence_publication(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.stop_reviewed_identity(text,text),app.pause_cadence_publication(text) TO cadence_app;

CREATE FUNCTION app.materialize_cadence_messages(p_now timestamptz,p_limit integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate record;e app.cadence_enrollment;p app.cadence_publication;conn app.channel_connection;sender app.channel_sender;person app.channel_identity;step jsonb;content jsonb;conv text;msg text;total integer:=0;current_role text;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 100 OR p_now IS NULL THEN RAISE EXCEPTION 'INVALID_LIMIT';END IF;
 FOR candidate IN SELECT en.workspace_id,en.id FROM app.cadence_enrollment en JOIN app.cadence_publication pub ON pub.workspace_id=en.workspace_id AND pub.id=en.publication_id WHERE en.state='active' AND pub.state='active' AND en.next_at<=p_now ORDER BY en.next_at,en.id LIMIT p_limit LOOP
  PERFORM 1 FROM app.workspace_meta WHERE workspace_id=candidate.workspace_id FOR UPDATE;
  SELECT * INTO e FROM app.cadence_enrollment WHERE workspace_id=candidate.workspace_id AND id=candidate.id FOR UPDATE;
  SELECT * INTO p FROM app.cadence_publication WHERE workspace_id=e.workspace_id AND id=e.publication_id;
  IF e.state<>'active' OR p.state<>'active' OR e.next_at>p_now OR EXISTS(SELECT 1 FROM app.message_outbox WHERE workspace_id=e.workspace_id AND enrollment_id=e.id AND step_index=e.next_step) THEN CONTINUE;END IF;
  SELECT role INTO current_role FROM auth.member WHERE "organizationId"=p.workspace_id AND "userId"=p.created_by;
  IF current_role IS NULL OR current_role NOT IN('owner','admin') THEN UPDATE app.cadence_enrollment SET state='blocked',stop_reason='AUTHORITY_REVOKED' WHERE workspace_id=e.workspace_id AND id=e.id;CONTINUE;END IF;
  SELECT * INTO conn FROM app.channel_connection WHERE workspace_id=e.workspace_id AND id=p.snapshot->'sender'->>'connectionId' FOR UPDATE;
  SELECT * INTO sender FROM app.channel_sender WHERE workspace_id=e.workspace_id AND id=p.snapshot->'sender'->>'id' FOR UPDATE;
  IF conn.state<>'ready' OR conn.revision<>(p.snapshot->>'connectionRevision')::bigint OR NOT sender.ready THEN UPDATE app.cadence_enrollment SET state='blocked',stop_reason='CONNECTION_CHANGED' WHERE workspace_id=e.workspace_id AND id=e.id;CONTINUE;END IF;
  SELECT * INTO person FROM app.channel_identity WHERE workspace_id=e.workspace_id AND id=e.identity_id FOR UPDATE;
  step:=p.snapshot->'cadence'->'steps'->e.next_step;
  IF step IS NULL THEN UPDATE app.cadence_enrollment SET state='completed' WHERE workspace_id=e.workspace_id AND id=e.id;CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM app.contact_suppression WHERE workspace_id=e.workspace_id AND identity_id=e.identity_id AND scope IN('all','campaign')) OR (person.reply_epoch>e.authorized_reply_epoch AND (COALESCE((p.snapshot->'cadence'->'settings'->>'stopOnReply')::boolean,false) OR COALESCE((step->>'stopOnReply')::boolean,false))) THEN
   UPDATE app.cadence_enrollment SET state='stopped',stop_reason='REPLY_OR_OPTOUT' WHERE workspace_id=e.workspace_id AND id=e.id;CONTINUE;
  END IF;
  content:=p.snapshot->'recipientContents'->e.lead_id->(step->>'id');IF content IS NULL OR step->>'channel'<>'WHATSAPP' THEN UPDATE app.cadence_enrollment SET state='blocked',stop_reason='CONTENT_UNAVAILABLE' WHERE workspace_id=e.workspace_id AND id=e.id;CONTINUE;END IF;
  INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id,lead_id) VALUES(e.workspace_id,gen_random_uuid()::text,conn.id,sender.id,person.id,e.lead_id) ON CONFLICT(workspace_id,sender_id,identity_id) DO NOTHING;
  SELECT id INTO conv FROM app.channel_conversation WHERE workspace_id=e.workspace_id AND sender_id=sender.id AND identity_id=person.id;
  msg:=gen_random_uuid()::text;
  INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,text,purpose) VALUES(e.workspace_id,msg,conn.id,sender.id,person.id,conv,'outbound',p.snapshot->'messagePreviews'->e.lead_id->>(step->>'id'),'campaign');
  INSERT INTO app.message_outbox(workspace_id,message_id,publication_id,enrollment_id,step_index,connection_id,sender_id,identity_id,actor_id,authority_kind,prepared_send,proof,next_at)
   VALUES(e.workspace_id,msg,p.id,e.id,e.next_step,conn.id,sender.id,person.id,p.created_by,'admin',jsonb_build_object('connectionId',conn.id,'connectionRevision',conn.revision,'senderId',sender.id,'identity',jsonb_build_object('scope',person.scope,'externalId',person.external_id,'phone',person.phone),'content',content,'purpose','campaign'),jsonb_build_object('senderRevision',sender.revision,'replyEpoch',e.authorized_reply_epoch),e.next_at);
  total:=total+1;
 END LOOP;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION app.materialize_cadence_messages(timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.materialize_cadence_messages(timestamptz,integer) TO cadence_dispatcher;
