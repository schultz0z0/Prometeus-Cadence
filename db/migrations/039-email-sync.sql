ALTER TABLE app.channel_conversation ADD COLUMN thread_key text NOT NULL DEFAULT '';
ALTER TABLE app.channel_conversation DROP CONSTRAINT channel_conversation_workspace_id_sender_id_identity_id_key;
ALTER TABLE app.channel_conversation ADD UNIQUE(workspace_id,sender_id,identity_id,thread_key);
CREATE UNIQUE INDEX whatsapp_single_conversation ON app.channel_conversation(workspace_id,sender_id,identity_id) WHERE channel='WHATSAPP';
ALTER TABLE app.channel_conversation ADD CHECK(channel<>'WHATSAPP' OR thread_key='');
ALTER TABLE app.email_thread ADD COLUMN needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE app.email_message ADD COLUMN classification_evidence jsonb NOT NULL DEFAULT '{}';
ALTER TABLE app.email_mailbox ADD COLUMN sync_gap boolean NOT NULL DEFAULT false;
-- Upgrade the conflict target together with the unique key, preserving all other legacy code.
DO $$ DECLARE f record;definition text;BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.prokind='f' LOOP
  definition:=pg_get_functiondef(f.oid);
  IF position('ON CONFLICT(workspace_id,sender_id,identity_id)' IN definition)>0 THEN EXECUTE replace(definition,'ON CONFLICT(workspace_id,sender_id,identity_id)','ON CONFLICT(workspace_id,sender_id,identity_id,thread_key)');END IF;
 END LOOP;
 SELECT pg_get_functiondef('app.lookup_channel_ingress(text)'::regprocedure) INTO definition;
 IF position('WHERE public_id=p_public;' IN definition)=0 THEN RAISE EXCEPTION 'INGRESS_UPGRADE_REQUIRED';END IF;
 EXECUTE replace(definition,'WHERE public_id=p_public;','WHERE public_id=p_public AND channel=''WHATSAPP'';');
END $$;
CREATE FUNCTION app.claim_mail_sync(p_now timestamptz,p_workspace text,p_mailbox text,p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record;result jsonb:='[]';token text;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 10 OR p_now IS NULL THEN RAISE EXCEPTION 'INVALID_SYNC_SCOPE';END IF;
 INSERT INTO app.email_sync_cursor(workspace_id,mailbox_id) SELECT m.workspace_id,m.id FROM app.email_mailbox m JOIN app.channel_connection c ON c.workspace_id=m.workspace_id AND c.id=m.id WHERE (p_workspace IS NULL OR m.workspace_id=p_workspace) AND(p_mailbox IS NULL OR m.id=p_mailbox) AND m.read_verified AND c.credentials_verified AND m.state IN('verifying','ready','attention') ON CONFLICT DO NOTHING;
 FOR r IN SELECT q.*,c.revision AS connection_revision FROM app.email_sync_cursor q JOIN app.email_mailbox m ON m.workspace_id=q.workspace_id AND m.id=q.mailbox_id JOIN app.channel_connection c ON c.workspace_id=q.workspace_id AND c.id=q.mailbox_id
 WHERE (p_workspace IS NULL OR q.workspace_id=p_workspace) AND(p_mailbox IS NULL OR q.mailbox_id=p_mailbox) AND m.state IN('verifying','ready','attention') AND m.read_verified AND c.credentials_verified AND q.next_at<=p_now AND(q.lease_until IS NULL OR q.lease_until<clock_timestamp())
 AND EXISTS(SELECT 1 FROM auth.member a WHERE a."organizationId"=q.workspace_id AND a."userId"=c.created_by AND a.role IN('owner','admin'))
 ORDER BY q.next_at,q.mailbox_id LIMIT p_limit FOR UPDATE OF q SKIP LOCKED LOOP
  token:=gen_random_uuid()::text;
  UPDATE app.email_sync_cursor SET lease_token=token,lease_until=clock_timestamp()+interval '90 seconds',fence=fence+1 WHERE workspace_id=r.workspace_id AND mailbox_id=r.mailbox_id AND folder=r.folder;
  result:=result||jsonb_build_array(jsonb_build_object('workspaceId',r.workspace_id,'mailboxId',r.mailbox_id,'token',token,'fence',r.fence+1,'revision',r.connection_revision,'expiresAt',clock_timestamp()+interval '90 seconds'));
 END LOOP;RETURN result;
END $$;
CREATE FUNCTION app.read_mail_sync(p_ws text,p_id text,p_token text,p_fence bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app.email_sync_cursor;m app.email_mailbox;c app.channel_connection;s app.channel_sender;envelope jsonb;
BEGIN
 SELECT * INTO q FROM app.email_sync_cursor WHERE workspace_id=p_ws AND mailbox_id=p_id AND lease_token=p_token AND fence=p_fence AND lease_until>clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'STALE_SYNC_LEASE';END IF;
 SELECT * INTO m FROM app.email_mailbox WHERE workspace_id=p_ws AND id=p_id;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=p_ws AND id=p_id;
 IF m.state NOT IN('verifying','ready','attention') OR NOT m.read_verified OR NOT c.credentials_verified OR NOT EXISTS(SELECT 1 FROM auth.member a WHERE a."organizationId"=p_ws AND a."userId"=c.created_by AND a.role IN('owner','admin')) THEN RAISE EXCEPTION 'SYNC_AUTHORITY_REVOKED';END IF;
 SELECT * INTO s FROM app.channel_sender WHERE workspace_id=p_ws AND connection_id=p_id LIMIT 1;
 SELECT cr.envelope INTO envelope FROM app.channel_credential cr WHERE cr.workspace_id=p_ws AND cr.connection_id=p_id AND cr.revision=c.revision;
 RETURN jsonb_build_object('mailbox',to_jsonb(m),'connection',to_jsonb(c),'sender',to_jsonb(s),'envelope',envelope,'cursor',COALESCE(q.pending_cursor,q.cursor));
END $$;
CREATE FUNCTION app.heartbeat_mail_sync(p_ws text,p_id text,p_token text,p_fence bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.read_mail_sync(p_ws,p_id,p_token,p_fence);
 UPDATE app.email_sync_cursor SET lease_until=clock_timestamp()+interval '90 seconds' WHERE workspace_id=p_ws AND mailbox_id=p_id AND lease_token=p_token AND fence=p_fence;RETURN FOUND;
END $$;
CREATE FUNCTION app.fail_mail_sync(p_ws text,p_id text,p_token text,p_fence bigint,p_recovery boolean,p_code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.read_mail_sync(p_ws,p_id,p_token,p_fence);
 UPDATE app.email_mailbox SET sync_state=CASE WHEN p_recovery THEN 'recovering' ELSE 'error' END,state='attention',last_error=left(p_code,100),sync_gap=sync_gap OR p_recovery WHERE workspace_id=p_ws AND id=p_id;
 UPDATE app.channel_sender SET ready=false WHERE workspace_id=p_ws AND connection_id=p_id;
 UPDATE app.email_sync_cursor SET lease_token=NULL,lease_until=NULL,next_at=clock_timestamp()+interval '60 seconds' WHERE workspace_id=p_ws AND mailbox_id=p_id AND lease_token=p_token AND fence=p_fence;
END $$;
CREATE FUNCTION app.commit_mail_sync(p_ws text,p_id text,p_token text,p_fence bigint,p_revision bigint,p_batch jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE scope_data jsonb;mail jsonb;sender app.channel_sender;box app.email_mailbox;person text;conv text;thread text;msg text;key text;matches text[];contact text;limited boolean:=false;complete boolean;gap boolean;ready boolean;
BEGIN
 scope_data:=app.read_mail_sync(p_ws,p_id,p_token,p_fence);
 PERFORM 1 FROM app.email_sync_cursor WHERE workspace_id=p_ws AND mailbox_id=p_id FOR UPDATE;
 IF (scope_data->'connection'->>'revision')::bigint<>p_revision OR pg_column_size(p_batch)>12582912 OR jsonb_typeof(p_batch->'messages')<>'array' OR jsonb_array_length(p_batch->'messages')>100 THEN RAISE EXCEPTION 'INVALID_SYNC_BATCH';END IF;
 SELECT * INTO box FROM app.email_mailbox WHERE workspace_id=p_ws AND id=p_id FOR UPDATE;
 SELECT * INTO sender FROM app.channel_sender WHERE workspace_id=p_ws AND connection_id=p_id LIMIT 1;
 FOR mail IN SELECT value FROM jsonb_array_elements(p_batch->'messages') LOOP
  IF sender.id IS NULL THEN RAISE EXCEPTION 'EMAIL_SENDER_REQUIRED';END IF;
  IF EXISTS(SELECT 1 FROM app.channel_message WHERE workspace_id=p_ws AND connection_id=p_id AND remote_id=mail->>'remoteId' AND direction=mail->>'direction') THEN CONTINUE;END IF;
  contact:=CASE WHEN mail->>'direction'='inbound' THEN mail->>'from' ELSE mail->'to'->>0 END;
  IF contact IS NULL OR contact='' THEN contact:='unknown:'||(mail->>'remoteId');END IF;
  INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES(p_ws,gen_random_uuid()::text,'email',contact) ON CONFLICT(workspace_id,scope,external_id) DO NOTHING;
  SELECT id INTO person FROM app.channel_identity WHERE workspace_id=p_ws AND scope='email' AND external_id=contact;
  SELECT array_agg(DISTINCT t.id) INTO matches FROM app.email_thread t JOIN app.channel_conversation v ON v.workspace_id=t.workspace_id AND v.id=t.conversation_id LEFT JOIN app.email_message em ON em.workspace_id=t.workspace_id AND em.thread_id=t.id
  WHERE t.workspace_id=p_ws AND t.mailbox_id=p_id AND v.identity_id=person AND((mail->>'remoteThreadId' IS NOT NULL AND t.remote_thread_id=mail->>'remoteThreadId') OR em.rfc_message_id=mail->>'inReplyTo' OR em.rfc_message_id IN(SELECT jsonb_array_elements_text(mail->'references')));
  thread:=NULL;conv:=NULL;
  IF cardinality(matches)=1 THEN thread:=matches[1];SELECT conversation_id INTO conv FROM app.email_thread WHERE workspace_id=p_ws AND id=thread;END IF;
  IF thread IS NULL THEN
   thread:=gen_random_uuid()::text;conv:=gen_random_uuid()::text;key:='message:'||(mail->>'remoteId');
   INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id,channel,thread_key) VALUES(p_ws,conv,p_id,sender.id,person,'EMAIL',thread);
   INSERT INTO app.email_thread(workspace_id,id,mailbox_id,conversation_id,thread_key,subject,remote_thread_id,needs_review) VALUES(p_ws,thread,p_id,conv,key,mail->>'subject',mail->>'remoteThreadId',COALESCE(cardinality(matches)>1,false));
  END IF;
  msg:=gen_random_uuid()::text;
  INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,text,state,remote_id,occurred_at,purpose,channel) VALUES(p_ws,msg,p_id,sender.id,person,conv,mail->>'direction',mail->>'text',CASE WHEN mail->>'direction'='inbound' THEN 'received' ELSE 'accepted' END,mail->>'remoteId',(mail->>'receivedAt')::timestamptz,'service','EMAIL');
  INSERT INTO app.email_message(workspace_id,message_id,mailbox_id,thread_id,rfc_message_id,in_reply_to,reference_ids,subject,from_address,to_addresses,origin,classification,attachments,truncated,classification_evidence) VALUES(p_ws,msg,p_id,thread,mail->>'rfcMessageId',mail->>'inReplyTo',mail->'references',mail->>'subject',mail->>'from',mail->'to','external',mail->>'classification',mail->'attachments',(mail->>'truncated')::boolean,jsonb_build_object('headers',mail->'headers','deliveryStatus',mail->'deliveryStatus'));
  IF (mail->>'truncated')::boolean OR mail->>'classification'='ambiguous' OR cardinality(matches)>1 THEN
   limited:=true;UPDATE app.email_thread SET needs_review=true WHERE workspace_id=p_ws AND id=thread;
  END IF;
 END LOOP;
 complete:=COALESCE((p_batch->>'complete')::boolean,false);gap:=box.sync_gap OR limited OR COALESCE((p_batch->>'gap')::boolean,false);
 UPDATE app.email_sync_cursor SET cursor=CASE WHEN complete THEN p_batch->'next' ELSE cursor END,pending_cursor=CASE WHEN complete THEN NULL ELSE p_batch->'next' END,revision=revision+1,lease_token=NULL,lease_until=NULL,next_at=clock_timestamp()+CASE WHEN complete THEN interval '60 seconds' ELSE interval '1 second' END WHERE workspace_id=p_ws AND mailbox_id=p_id;
 ready:=complete AND NOT gap AND box.proof_verified AND box.send_verified AND box.read_verified AND sender.daily_limit IS NOT NULL AND EXISTS(SELECT 1 FROM app.messaging_limits WHERE workspace_id=p_ws) AND EXISTS(SELECT 1 FROM app.messaging_channel_limits WHERE workspace_id=p_ws AND channel='EMAIL');
 UPDATE app.email_mailbox SET baseline_at=COALESCE(baseline_at,clock_timestamp()),sync_gap=gap,sync_state=CASE WHEN gap THEN 'recovering' WHEN complete THEN 'ready' ELSE 'baseline' END,last_synced_at=CASE WHEN complete AND NOT gap THEN clock_timestamp() ELSE last_synced_at END,state=CASE WHEN gap THEN 'attention' WHEN ready THEN 'ready' ELSE 'verifying' END,last_error=CASE WHEN gap THEN 'EMAIL_SYNC_REVIEW_REQUIRED' ELSE NULL END WHERE workspace_id=p_ws AND id=p_id;
 UPDATE app.channel_sender SET ready=ready WHERE workspace_id=p_ws AND connection_id=p_id;
 UPDATE app.channel_connection SET state=CASE WHEN ready THEN 'ready' ELSE 'credentials_verified' END WHERE workspace_id=p_ws AND id=p_id;
END $$;
REVOKE ALL ON FUNCTION app.claim_mail_sync(timestamptz,text,text,integer),app.read_mail_sync(text,text,text,bigint),app.heartbeat_mail_sync(text,text,text,bigint),app.fail_mail_sync(text,text,text,bigint,boolean,text),app.commit_mail_sync(text,text,text,bigint,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_mail_sync(timestamptz,text,text,integer),app.read_mail_sync(text,text,text,bigint),app.heartbeat_mail_sync(text,text,text,bigint),app.fail_mail_sync(text,text,text,bigint,boolean,text),app.commit_mail_sync(text,text,text,bigint,bigint,jsonb) TO cadence_dispatcher;
