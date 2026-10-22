ALTER TABLE app.cadence_enrollment ALTER COLUMN identity_id DROP NOT NULL;
CREATE TABLE app.cadence_enrollment_channel(
 workspace_id text NOT NULL,enrollment_id text NOT NULL,step_index integer NOT NULL CHECK(step_index>=0),step_id text NOT NULL,
 channel text NOT NULL CHECK(channel IN('EMAIL','WHATSAPP')),identity_id text NOT NULL,sender_id text NOT NULL,authorized_reply_epoch bigint NOT NULL,
 PRIMARY KEY(workspace_id,enrollment_id,step_index),UNIQUE(workspace_id,enrollment_id,step_id),
 FOREIGN KEY(workspace_id,enrollment_id) REFERENCES app.cadence_enrollment(workspace_id,id),
 FOREIGN KEY(workspace_id,identity_id) REFERENCES app.channel_identity(workspace_id,id),
 FOREIGN KEY(workspace_id,sender_id) REFERENCES app.channel_sender(workspace_id,id)
);
ALTER TABLE app.cadence_enrollment_channel ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.cadence_enrollment_channel FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON app.cadence_enrollment_channel FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
CREATE POLICY admin_insert ON app.cadence_enrollment_channel FOR INSERT WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
GRANT SELECT,INSERT ON app.cadence_enrollment_channel TO cadence_app;
CREATE FUNCTION app.check_enrollment_channels() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e app.cadence_enrollment;snapshot jsonb;step jsonb;idx integer:=0;a app.cadence_enrollment_channel;
BEGIN
 SELECT * INTO e FROM app.cadence_enrollment WHERE workspace_id=NEW.workspace_id AND id=CASE WHEN TG_TABLE_NAME='cadence_enrollment' THEN NEW.id ELSE NEW.enrollment_id END;
 SELECT p.snapshot INTO snapshot FROM app.cadence_publication p WHERE p.workspace_id=e.workspace_id AND p.id=e.publication_id;
 IF snapshot->>'version' IS DISTINCT FROM '2' THEN IF e.identity_id IS NULL THEN RAISE EXCEPTION 'LEGACY_IDENTITY_REQUIRED';END IF;RETURN NEW;END IF;
 IF e.identity_id IS NOT NULL THEN RAISE EXCEPTION 'V2_STEP_IDENTITIES_REQUIRED';END IF;
 IF (SELECT count(*) FROM app.cadence_enrollment_channel WHERE workspace_id=e.workspace_id AND enrollment_id=e.id)<>jsonb_array_length(snapshot->'cadence'->'steps') THEN RAISE EXCEPTION 'INCOMPLETE_ENROLLMENT_CHANNELS';END IF;
 FOR step IN SELECT value FROM jsonb_array_elements(snapshot->'cadence'->'steps') LOOP
  SELECT * INTO a FROM app.cadence_enrollment_channel WHERE workspace_id=e.workspace_id AND enrollment_id=e.id AND step_index=idx;
  IF NOT FOUND OR a.step_id<>step->>'id' OR a.channel<>step->>'channel' OR NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(snapshot->'recipients') r JOIN app.channel_sender s ON s.workspace_id=e.workspace_id AND s.id=a.sender_id
   JOIN app.channel_identity i ON i.workspace_id=e.workspace_id AND i.id=a.identity_id
   WHERE r->>'leadId'=e.lead_id AND r->'steps'->a.step_id->>'identityId'=a.identity_id AND r->'steps'->a.step_id->'sender'->>'id'=a.sender_id AND s.channel=a.channel AND ((a.channel='EMAIL' AND i.scope='email') OR(a.channel='WHATSAPP' AND i.scope=s.identity_scope))
  ) THEN RAISE EXCEPTION 'INVALID_ENROLLMENT_CHANNEL';END IF;
  idx:=idx+1;
 END LOOP;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER complete_enrollment AFTER INSERT OR UPDATE ON app.cadence_enrollment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_enrollment_channels();
CREATE CONSTRAINT TRIGGER complete_channel AFTER INSERT OR UPDATE ON app.cadence_enrollment_channel DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_enrollment_channels();
REVOKE ALL ON FUNCTION app.check_enrollment_channels() FROM PUBLIC;
CREATE TABLE app.email_unsubscribe_token(
 token_hash text PRIMARY KEY CHECK(token_hash~'^[a-f0-9]{64}$'),workspace_id text NOT NULL,identity_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),used_at timestamptz,
 FOREIGN KEY(workspace_id,identity_id) REFERENCES app.channel_identity(workspace_id,id)
);
ALTER TABLE app.email_unsubscribe_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.email_unsubscribe_token FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.email_unsubscribe_token FROM PUBLIC,cadence_app,cadence_dispatcher,cadence_ingress;
CREATE FUNCTION app.register_mail_unsubscribe(p_identity text,p_hash text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') OR NOT EXISTS(SELECT 1 FROM app.channel_identity WHERE workspace_id=ws AND id=p_identity AND scope='email') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 INSERT INTO app.email_unsubscribe_token(token_hash,workspace_id,identity_id) VALUES(p_hash,ws,p_identity) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM app.email_unsubscribe_token WHERE token_hash=p_hash AND workspace_id=ws AND identity_id=p_identity) THEN RAISE EXCEPTION 'TOKEN_COLLISION';END IF;
END $$;
REVOKE ALL ON FUNCTION app.register_mail_unsubscribe(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_mail_unsubscribe(text,text) TO cadence_app;

-- Called only by the existing materializer after the common due ordering and locks.
CREATE FUNCTION app.materialize_multichannel_enrollment(p_ws text,p_enrollment text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e app.cadence_enrollment;p app.cadence_publication;a app.cadence_enrollment_channel;s app.channel_sender;c app.channel_connection;i app.channel_identity;
 step jsonb;frozen jsonb;content jsonb;conv text;msg text;thread_id text;key text;rfc text;parent record;prepared jsonb;mail_thread app.email_thread;
BEGIN
 SELECT * INTO e FROM app.cadence_enrollment WHERE workspace_id=p_ws AND id=p_enrollment;
 SELECT * INTO p FROM app.cadence_publication WHERE workspace_id=p_ws AND id=e.publication_id;
 step:=p.snapshot->'cadence'->'steps'->e.next_step;
 IF step IS NULL THEN UPDATE app.cadence_enrollment SET state='completed' WHERE workspace_id=p_ws AND id=e.id;RETURN 0;END IF;
 SELECT r->'steps'->(step->>'id') INTO frozen FROM jsonb_array_elements(p.snapshot->'recipients') r WHERE r->>'leadId'=e.lead_id;
 SELECT * INTO a FROM app.cadence_enrollment_channel WHERE workspace_id=p_ws AND enrollment_id=e.id AND step_index=e.next_step;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=p_ws AND id=frozen->'sender'->>'connectionId' FOR UPDATE;
 SELECT * INTO s FROM app.channel_sender WHERE workspace_id=p_ws AND id=a.sender_id FOR UPDATE;
 SELECT * INTO i FROM app.channel_identity WHERE workspace_id=p_ws AND id=a.identity_id FOR UPDATE;
 IF frozen IS NULL OR s.id IS NULL OR c.id IS NULL OR i.id IS NULL OR c.state<>'ready' OR c.revision<>(frozen->>'connectionRevision')::bigint OR s.revision<>(frozen->'sender'->>'revision')::bigint OR NOT s.ready OR s.channel<>a.channel THEN
  UPDATE app.cadence_enrollment SET state='blocked',stop_reason='CONNECTION_CHANGED' WHERE workspace_id=p_ws AND id=e.id;RETURN 0;
 END IF;
 IF EXISTS(SELECT 1 FROM app.contact_suppression WHERE workspace_id=p_ws AND identity_id=i.id AND scope IN('all','campaign')) OR(i.reply_epoch>a.authorized_reply_epoch AND(COALESCE((p.snapshot->'cadence'->'settings'->>'stopOnReply')::boolean,false) OR COALESCE((step->>'stopOnReply')::boolean,false))) THEN
  UPDATE app.cadence_enrollment SET state='stopped',stop_reason='REPLY_OR_OPTOUT' WHERE workspace_id=p_ws AND id=e.id;RETURN 0;
 END IF;
 content:=frozen->'content';msg:=gen_random_uuid()::text;key:=CASE WHEN a.channel='EMAIL' THEN 'enrollment:'||e.id ELSE '' END;
 INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id,lead_id,channel,thread_key)
 VALUES(p_ws,gen_random_uuid()::text,c.id,s.id,i.id,e.lead_id,a.channel,key) ON CONFLICT(workspace_id,sender_id,identity_id,thread_key) DO NOTHING;
 SELECT id INTO conv FROM app.channel_conversation WHERE workspace_id=p_ws AND sender_id=s.id AND identity_id=i.id AND thread_key=key;
 INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,channel,direction,text,purpose)
 VALUES(p_ws,msg,c.id,s.id,i.id,conv,a.channel,'outbound',frozen->>'preview','campaign');
 IF a.channel='EMAIL' THEN
  INSERT INTO app.email_thread(workspace_id,id,mailbox_id,conversation_id,thread_key,subject) VALUES(p_ws,gen_random_uuid()::text,c.id,conv,key,content->>'subject') ON CONFLICT(workspace_id,mailbox_id,thread_key) DO NOTHING;
  SELECT * INTO mail_thread FROM app.email_thread WHERE workspace_id=p_ws AND mailbox_id=c.id AND thread_key=key;
  rfc:='<'||msg||'@'||split_part(s.address,'@',2)||'>';
  SELECT m.rfc_message_id,m.reference_ids INTO parent FROM app.email_message m JOIN app.channel_message cm ON cm.workspace_id=m.workspace_id AND cm.id=m.message_id
   WHERE m.workspace_id=p_ws AND m.thread_id=mail_thread.id AND cm.state IN('accepted','sent','delivered','read') ORDER BY cm.created_at DESC LIMIT 1;
  INSERT INTO app.email_message(workspace_id,message_id,mailbox_id,thread_id,rfc_message_id,in_reply_to,reference_ids,subject,from_address,to_addresses,origin,classification)
  VALUES(p_ws,msg,c.id,mail_thread.id,rfc,parent.rfc_message_id,COALESCE(parent.reference_ids,'[]')||CASE WHEN parent.rfc_message_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(parent.rfc_message_id) END,content->>'subject',s.address,jsonb_build_array(i.external_id),'app','human');
  prepared:=jsonb_build_object('channel','EMAIL','connectionId',c.id,'connectionRevision',c.revision,'senderId',s.id,'address',s.address,'to',i.external_id,'content',content,'rfcMessageId',rfc,
   'thread',jsonb_build_object('remoteThreadId',mail_thread.remote_thread_id,'inReplyTo',parent.rfc_message_id,'references',COALESCE(parent.reference_ids,'[]')||CASE WHEN parent.rfc_message_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(parent.rfc_message_id) END),'purpose','campaign','unsubscribeUrl',frozen->'unsubscribe'->>'url');
 ELSE
  prepared:=jsonb_build_object('channel','WHATSAPP','connectionId',c.id,'connectionRevision',c.revision,'senderId',s.id,'identity',jsonb_build_object('scope',i.scope,'externalId',i.external_id,'phone',i.phone),'content',content,'purpose','campaign');
 END IF;
 INSERT INTO app.message_outbox(workspace_id,message_id,publication_id,enrollment_id,step_index,connection_id,sender_id,identity_id,actor_id,authority_kind,prepared_send,proof,next_at)
 VALUES(p_ws,msg,p.id,e.id,e.next_step,c.id,s.id,i.id,p.created_by,'admin',prepared,jsonb_build_object('version',2,'senderRevision',s.revision,'replyEpoch',a.authorized_reply_epoch),e.next_at);
 RETURN 1;
END $$;
REVOKE ALL ON FUNCTION app.materialize_multichannel_enrollment(text,text) FROM PUBLIC;
DO $$ DECLARE definition text;needle text:='  SELECT * INTO conn FROM app.channel_connection';BEGIN
 SELECT pg_get_functiondef('app.materialize_cadence_messages(timestamptz,integer,text)'::regprocedure) INTO definition;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'MATERIALIZATION_UPGRADE_REQUIRED';END IF;
 EXECUTE replace(definition,needle,'  IF p.snapshot->>''version''=''2'' THEN total:=total+app.materialize_multichannel_enrollment(e.workspace_id,e.id);CONTINUE;END IF;'||chr(10)||needle);
END $$;
