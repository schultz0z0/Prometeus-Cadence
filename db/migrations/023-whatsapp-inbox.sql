CREATE TABLE app.channel_identity(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,scope text NOT NULL,external_id text NOT NULL,phone text,
 last_inbound_at timestamptz,reply_epoch bigint NOT NULL DEFAULT 0,last_reply_at timestamptz,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,scope,external_id),CHECK(length(scope)<=200 AND length(external_id)<=512)
);
CREATE TABLE app.channel_conversation(
 workspace_id text NOT NULL,id text NOT NULL,connection_id text NOT NULL,sender_id text NOT NULL,identity_id text NOT NULL,lead_id text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_message_at timestamptz,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,sender_id,identity_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES app.channel_connection(workspace_id,id),
 FOREIGN KEY(workspace_id,sender_id) REFERENCES app.channel_sender(workspace_id,id),
 FOREIGN KEY(workspace_id,identity_id) REFERENCES app.channel_identity(workspace_id,id),
 FOREIGN KEY(workspace_id,lead_id) REFERENCES app.lead(workspace_id,id)
);
CREATE TABLE app.channel_message(
 workspace_id text NOT NULL,id text NOT NULL,message_order bigint GENERATED ALWAYS AS IDENTITY,
 connection_id text NOT NULL,sender_id text NOT NULL,identity_id text NOT NULL,conversation_id text NOT NULL,
 direction text NOT NULL CHECK(direction IN('inbound','outbound')),text text,media_kind text,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('received','pending','dispatching','accepted','delivered','read','failed','uncertain','cancelled','blocked')),
 remote_id text,occurred_at timestamptz,accepted_at timestamptz,delivered_at timestamptz,read_at timestamptz,error_code text,
 purpose text NOT NULL DEFAULT 'service' CHECK(purpose IN('service','campaign','test')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,connection_id,direction,remote_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES app.channel_connection(workspace_id,id),
 FOREIGN KEY(workspace_id,sender_id) REFERENCES app.channel_sender(workspace_id,id),
 FOREIGN KEY(workspace_id,identity_id) REFERENCES app.channel_identity(workspace_id,id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES app.channel_conversation(workspace_id,id),CHECK(text IS NULL OR length(text)<=4096)
);
CREATE INDEX channel_messages_thread ON app.channel_message(workspace_id,conversation_id,message_order DESC);
CREATE TABLE app.channel_conversation_read(
 workspace_id text NOT NULL,conversation_id text NOT NULL,user_id text NOT NULL,message_order bigint NOT NULL,
 PRIMARY KEY(workspace_id,conversation_id,user_id),FOREIGN KEY(workspace_id,conversation_id) REFERENCES app.channel_conversation(workspace_id,id)
);
CREATE TABLE app.channel_received_event(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id text NOT NULL,connection_id text NOT NULL,credential_revision bigint NOT NULL,
 dedup_key text NOT NULL,body_hash text,kind text NOT NULL,event_metadata jsonb,remote_id text,message_id text,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),metadata_pruned_at timestamptz,
 time_lookup_state text NOT NULL DEFAULT 'none' CHECK(time_lookup_state IN('none','pending','running','done')),
 lookup_token text,lookup_until timestamptz,retry_at timestamptz,
 UNIQUE(workspace_id,connection_id,dedup_key),FOREIGN KEY(workspace_id,connection_id) REFERENCES app.channel_connection(workspace_id,id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES app.channel_message(workspace_id,id)
);
CREATE TABLE app.channel_status_evidence(
 workspace_id text NOT NULL,connection_id text NOT NULL,remote_id text NOT NULL,status text NOT NULL,event_id bigint NOT NULL UNIQUE,
 occurred_at timestamptz,error_code text,PRIMARY KEY(workspace_id,connection_id,remote_id,status),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES app.channel_connection(workspace_id,id),FOREIGN KEY(event_id) REFERENCES app.channel_received_event(id)
);
CREATE TABLE app.consent_evidence(
 workspace_id text NOT NULL,id text NOT NULL,identity_id text NOT NULL,purpose text NOT NULL CHECK(purpose IN('service','campaign','test')),
 source text NOT NULL,occurred_at timestamptz NOT NULL,evidence text NOT NULL,actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,identity_id) REFERENCES app.channel_identity(workspace_id,id)
);
CREATE TABLE app.contact_suppression(
 workspace_id text NOT NULL,identity_id text NOT NULL,scope text NOT NULL DEFAULT 'all' CHECK(scope IN('all','campaign','service','test')),
 reason text NOT NULL,source_event_id bigint,actor_id text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,identity_id,scope),FOREIGN KEY(workspace_id,identity_id) REFERENCES app.channel_identity(workspace_id,id),FOREIGN KEY(source_event_id) REFERENCES app.channel_received_event(id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['channel_identity','channel_conversation','channel_message','channel_conversation_read','channel_received_event','channel_status_evidence','consent_evidence','contact_suppression'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON app.%I FROM cadence_app',t);
  IF t<>'channel_received_event' THEN
   EXECUTE format('CREATE POLICY tenant_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
   EXECUTE format('GRANT SELECT ON app.%I TO cadence_app',t);
  END IF;
 END LOOP;
END $$;
CREATE POLICY member_insert ON app.channel_identity FOR INSERT WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL AND last_inbound_at IS NULL AND reply_epoch=0 AND last_reply_at IS NULL);
CREATE POLICY member_insert ON app.channel_conversation FOR INSERT WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
CREATE POLICY admin_link ON app.channel_conversation FOR UPDATE USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin')) WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
CREATE POLICY own_read_insert ON app.channel_conversation_read FOR INSERT WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND user_id=current_setting('app.user_id',true) AND app.current_role() IS NOT NULL);
CREATE POLICY own_read_update ON app.channel_conversation_read FOR UPDATE USING(workspace_id=current_setting('app.workspace_id',true) AND user_id=current_setting('app.user_id',true) AND app.current_role() IS NOT NULL);
CREATE POLICY outbound_insert ON app.channel_message FOR INSERT WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL AND direction='outbound' AND state='pending' AND remote_id IS NULL AND occurred_at IS NULL AND accepted_at IS NULL AND delivered_at IS NULL AND read_at IS NULL);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['consent_evidence','contact_suppression'] LOOP
 EXECUTE format('CREATE POLICY admin_insert ON app.%I FOR INSERT WITH CHECK(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IN(''owner'',''admin''))',t);
 EXECUTE format('GRANT INSERT ON app.%I TO cadence_app',t);
END LOOP;END $$;
GRANT INSERT(workspace_id,id,scope,external_id,phone) ON app.channel_identity TO cadence_app;
GRANT INSERT(workspace_id,id,connection_id,sender_id,identity_id,lead_id) ON app.channel_conversation TO cadence_app;
GRANT UPDATE(lead_id) ON app.channel_conversation TO cadence_app;
GRANT INSERT,UPDATE ON app.channel_conversation_read TO cadence_app;
GRANT INSERT(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,text,purpose) ON app.channel_message TO cadence_app;
GRANT USAGE,SELECT ON SEQUENCE app.channel_message_message_order_seq TO cadence_app;

CREATE FUNCTION app.apply_channel_status(p_connection text,p_remote text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE conn app.channel_connection;msg app.channel_message;e app.channel_status_evidence;
BEGIN
 SELECT * INTO conn FROM app.channel_connection WHERE id=p_connection;
 SELECT * INTO msg FROM app.channel_message WHERE workspace_id=conn.workspace_id AND connection_id=p_connection AND direction='outbound' AND remote_id=p_remote FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 FOR e IN SELECT * FROM app.channel_status_evidence WHERE workspace_id=conn.workspace_id AND connection_id=p_connection AND remote_id=p_remote ORDER BY event_id LOOP
  IF e.status='read' THEN msg.read_at:=COALESCE(msg.read_at,e.occurred_at,clock_timestamp());msg.delivered_at:=COALESCE(msg.delivered_at,e.occurred_at,clock_timestamp());
  ELSIF e.status='delivered' THEN msg.delivered_at:=COALESCE(msg.delivered_at,e.occurred_at,clock_timestamp());
  ELSIF e.status IN('failed','undelivered') THEN msg.error_code:=COALESCE(e.error_code,'DELIVERY_FAILED');END IF;
  msg.state:=CASE WHEN msg.read_at IS NOT NULL THEN 'read' WHEN msg.delivered_at IS NOT NULL THEN 'delivered' WHEN msg.error_code IS NOT NULL THEN 'failed' ELSE 'accepted' END;
 END LOOP;
 UPDATE app.channel_message SET state=msg.state,delivered_at=msg.delivered_at,read_at=msg.read_at,error_code=msg.error_code WHERE workspace_id=msg.workspace_id AND id=msg.id;
END $$;
REVOKE ALL ON FUNCTION app.apply_channel_status(text,text) FROM PUBLIC;

CREATE FUNCTION app.ingest_channel_batch(p_batch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE conn app.channel_connection;cred app.channel_credential;sender app.channel_sender;event jsonb;ev_id bigint;person text;conv text;msg text;at timestamptz;received timestamptz:=clock_timestamp();stored integer:=0;duplicates integer:=0;is_current boolean;reply_text text;
BEGIN
 IF pg_column_size(p_batch)>2097152 OR jsonb_typeof(p_batch->'events')<>'array' OR jsonb_array_length(p_batch->'events')>2000 THEN RAISE EXCEPTION 'INVALID_BATCH';END IF;
 SELECT * INTO conn FROM app.channel_connection WHERE id=p_batch->>'connectionId';IF NOT FOUND THEN RAISE EXCEPTION 'CHANNEL_NOT_FOUND';END IF;
 -- Same first lock as dispatch: serialize tenant mutations before identity/message locks.
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=conn.workspace_id FOR UPDATE;
 SELECT * INTO conn FROM app.channel_connection WHERE id=conn.id FOR UPDATE;
 SELECT * INTO cred FROM app.channel_credential WHERE workspace_id=conn.workspace_id AND connection_id=conn.id AND revision=(p_batch->>'credentialRevision')::bigint;
 IF NOT FOUND OR cred.verified_account_id IS NULL THEN RAISE EXCEPTION 'UNVERIFIED_CHANNEL';END IF;
 is_current:=conn.revision=cred.revision AND conn.credentials_verified AND conn.state NOT IN('disconnected','pending');
 FOR event IN SELECT value FROM jsonb_array_elements(p_batch->'events') LOOP
  IF event->>'accountId' IS DISTINCT FROM cred.verified_account_id THEN RAISE EXCEPTION 'CALLBACK_ACCOUNT_MISMATCH';END IF;
  IF event->>'kind'='inbound' AND NOT is_current THEN CONTINUE;END IF;
  IF length(event->>'dedupKey')<>64 THEN RAISE EXCEPTION 'INVALID_EVENT';END IF;
  INSERT INTO app.channel_received_event(workspace_id,connection_id,credential_revision,dedup_key,body_hash,kind,event_metadata,remote_id)
   VALUES(conn.workspace_id,conn.id,cred.revision,event->>'dedupKey',p_batch->>'bodyHash',event->>'kind',event-'text',event->>'remoteId')
   ON CONFLICT(workspace_id,connection_id,dedup_key) DO NOTHING RETURNING id INTO ev_id;
  IF NOT FOUND THEN duplicates:=duplicates+1;CONTINUE;END IF;
  stored:=stored+1;at:=(event->>'occurredAt')::timestamptz;
  IF event->>'senderExternalId' IS NOT NULL THEN
   SELECT * INTO sender FROM app.channel_sender WHERE workspace_id=conn.workspace_id AND connection_id=conn.id AND external_id=event->>'senderExternalId';
   IF NOT FOUND THEN RAISE EXCEPTION 'CALLBACK_SENDER_MISMATCH';END IF;
  END IF;
  IF event->>'kind'='inbound' THEN
   IF sender.id IS NULL OR event->'identity'->>'scope'<>conn.provider||':'||cred.verified_account_id THEN RAISE EXCEPTION 'CALLBACK_IDENTITY_MISMATCH';END IF;
   INSERT INTO app.channel_identity(workspace_id,id,scope,external_id,phone) VALUES(conn.workspace_id,gen_random_uuid()::text,event->'identity'->>'scope',event->'identity'->>'externalId',event->'identity'->>'phone')
    ON CONFLICT(workspace_id,scope,external_id) DO NOTHING;
   SELECT id INTO person FROM app.channel_identity WHERE workspace_id=conn.workspace_id AND scope=event->'identity'->>'scope' AND external_id=event->'identity'->>'externalId' FOR UPDATE;
   INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id) VALUES(conn.workspace_id,gen_random_uuid()::text,conn.id,sender.id,person) ON CONFLICT(workspace_id,sender_id,identity_id) DO NOTHING;
   SELECT id INTO conv FROM app.channel_conversation WHERE workspace_id=conn.workspace_id AND sender_id=sender.id AND identity_id=person;
   msg:=NULL;
   INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,text,media_kind,state,remote_id,occurred_at)
    VALUES(conn.workspace_id,gen_random_uuid()::text,conn.id,sender.id,person,conv,'inbound',event->>'text',event->>'mediaKind','received',event->>'remoteId',at)
    ON CONFLICT(workspace_id,connection_id,direction,remote_id) DO NOTHING RETURNING id INTO msg;
   IF msg IS NOT NULL THEN
    UPDATE app.channel_identity SET reply_epoch=reply_epoch+1,last_reply_at=received,last_inbound_at=CASE WHEN at IS NOT NULL AND at<=received AND (last_inbound_at IS NULL OR at>last_inbound_at) THEN at ELSE last_inbound_at END WHERE workspace_id=conn.workspace_id AND id=person;
    UPDATE app.channel_conversation SET last_message_at=received WHERE workspace_id=conn.workspace_id AND id=conv;
    reply_text:=lower(btrim(COALESCE(event->>'text','')));
    IF reply_text IN('parar','sair','cancelar','stop','não quero','nao quero') THEN
     INSERT INTO app.contact_suppression(workspace_id,identity_id,reason,source_event_id) VALUES(conn.workspace_id,person,'inbound_optout',ev_id) ON CONFLICT DO NOTHING;
    END IF;
   ELSE SELECT id INTO msg FROM app.channel_message WHERE workspace_id=conn.workspace_id AND connection_id=conn.id AND direction='inbound' AND remote_id=event->>'remoteId';END IF;
   UPDATE app.channel_received_event SET message_id=msg,time_lookup_state=CASE WHEN conn.provider='twilio' AND at IS NULL THEN 'pending' ELSE 'none' END WHERE id=ev_id;
   UPDATE app.channel_connection SET inbound_verified=true,state='ready' WHERE workspace_id=conn.workspace_id AND id=conn.id;
   UPDATE app.channel_sender SET ready=true WHERE workspace_id=conn.workspace_id AND id=sender.id;
  ELSIF event->>'kind'='status' THEN
   INSERT INTO app.channel_status_evidence(workspace_id,connection_id,remote_id,status,event_id,occurred_at,error_code) VALUES(conn.workspace_id,conn.id,event->>'remoteId',event->>'status',ev_id,at,event->>'errorCode') ON CONFLICT DO NOTHING;
   PERFORM app.apply_channel_status(conn.id,event->>'remoteId');
  ELSIF event->>'kind'='template' AND is_current THEN
   UPDATE app.channel_remote_template SET revision=revision+1,payload=payload||jsonb_build_object('status',event->>'status','revision',revision+1,'hash','event:'||(event->>'dedupKey')) WHERE workspace_id=conn.workspace_id AND connection_id=conn.id AND remote_id=event->>'remoteId';
  END IF;
 END LOOP;
 RETURN jsonb_build_object('stored',stored,'duplicates',duplicates);
END $$;
REVOKE ALL ON FUNCTION app.ingest_channel_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ingest_channel_batch(jsonb) TO cadence_ingress;

CREATE FUNCTION app.claim_channel_time_lookup() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e app.channel_received_event;token text:=gen_random_uuid()::text;
BEGIN
 SELECT * INTO e FROM app.channel_received_event WHERE time_lookup_state IN('pending','running') AND (lookup_until IS NULL OR lookup_until<clock_timestamp()) AND (retry_at IS NULL OR retry_at<=clock_timestamp()) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE app.channel_received_event SET time_lookup_state='running',lookup_token=token,lookup_until=clock_timestamp()+interval '40 seconds' WHERE id=e.id;
 RETURN jsonb_build_object('eventId',e.id,'token',token,'remoteId',e.remote_id,'publicId',(SELECT public_id FROM app.channel_connection WHERE id=e.connection_id));
END $$;
CREATE FUNCTION app.finish_channel_time_lookup(p_id bigint,p_token text,p_time timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e app.channel_received_event;m app.channel_message;
BEGIN
 SELECT * INTO e FROM app.channel_received_event WHERE id=p_id;IF NOT FOUND THEN RETURN;END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=e.workspace_id FOR UPDATE;
 SELECT * INTO e FROM app.channel_received_event WHERE id=p_id AND lookup_token=p_token AND lookup_until>clock_timestamp() FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;
 IF p_time IS NULL OR p_time>e.received_at THEN
  UPDATE app.channel_received_event SET time_lookup_state='pending',lookup_token=NULL,lookup_until=NULL,retry_at=clock_timestamp()+interval '60 seconds' WHERE id=e.id;RETURN;
 END IF;
 SELECT * INTO m FROM app.channel_message WHERE workspace_id=e.workspace_id AND id=e.message_id;
 UPDATE app.channel_message SET occurred_at=p_time WHERE workspace_id=m.workspace_id AND id=m.id;
 UPDATE app.channel_identity SET last_inbound_at=GREATEST(last_inbound_at,p_time) WHERE workspace_id=m.workspace_id AND id=m.identity_id;
 UPDATE app.channel_received_event SET time_lookup_state='done',lookup_token=NULL,lookup_until=NULL WHERE id=e.id;
END $$;
REVOKE ALL ON FUNCTION app.claim_channel_time_lookup(),app.finish_channel_time_lookup(bigint,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_channel_time_lookup(),app.finish_channel_time_lookup(bigint,text,timestamptz) TO cadence_ingress;
