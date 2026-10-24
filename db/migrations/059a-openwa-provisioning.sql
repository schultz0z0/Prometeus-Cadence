-- Extend the new lifecycle without rewriting the checksum of migration 059.
ALTER TABLE app.openwa_connection ADD COLUMN restart_requested boolean NOT NULL DEFAULT false;
ALTER TABLE app.openwa_connection DROP CONSTRAINT openwa_connection_stage_check;
ALTER TABLE app.openwa_connection ADD CONSTRAINT openwa_connection_stage_check CHECK(stage IN('session','key','webhook','stop','start','observe','logout','revoke','idle'));
CREATE OR REPLACE FUNCTION app.read_openwa_operation(p_ws text,p_connection text,p_token text,p_fence bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app.openwa_connection;c app.channel_connection;envelope jsonb;
BEGIN
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=p_ws AND id=p_connection FOR UPDATE;
 IF NOT FOUND OR c.provider<>'openwa' THEN RAISE EXCEPTION 'STALE_OPENWA_LEASE';END IF;
 SELECT * INTO q FROM app.openwa_connection WHERE workspace_id=p_ws AND connection_id=p_connection AND lease_token=p_token AND fence=p_fence AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR c.revision<>q.revision OR q.lease_revision<>q.revision THEN RAISE EXCEPTION 'STALE_OPENWA_LEASE';END IF;
 PERFORM 1 FROM auth.member m WHERE m."organizationId"=p_ws AND m."userId"=q.requested_by AND m.role IN('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OPENWA_AUTHORITY_REVOKED';END IF;
 IF(q.desired_state='disconnected' AND q.stage NOT IN('logout','revoke','idle')) OR(q.desired_state='connected' AND q.stage IN('logout','revoke','idle')) THEN RAISE EXCEPTION 'STALE_OPENWA_LEASE';END IF;
 SELECT cr.envelope INTO envelope FROM app.channel_credential cr WHERE cr.workspace_id=p_ws AND cr.connection_id=p_connection AND cr.revision=c.revision;
 RETURN jsonb_build_object('operation',to_jsonb(q),'connection',to_jsonb(c),'envelope',envelope);
END $$;
ALTER FUNCTION app.finish_openwa_operation(text,text,text,bigint,jsonb) RENAME TO finish_openwa_base_operation;
REVOKE ALL ON FUNCTION app.finish_openwa_base_operation(text,text,text,bigint,jsonb) FROM PUBLIC,cadence_dispatcher;
CREATE FUNCTION app.finish_openwa_operation(p_ws text,p_connection text,p_token text,p_fence bigint,p_result jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE scope jsonb;q app.openwa_connection;conn app.channel_connection;kind text:=p_result->>'kind';v_phase text;v_phone text;v_ready boolean;
BEGIN
 scope:=app.read_openwa_operation(p_ws,p_connection,p_token,p_fence);
 SELECT * INTO q FROM app.openwa_connection WHERE workspace_id=p_ws AND connection_id=p_connection FOR UPDATE;
 SELECT * INTO conn FROM app.channel_connection WHERE workspace_id=p_ws AND id=p_connection;
 IF pg_column_size(p_result)>131072 OR jsonb_typeof(p_result)<>'object' THEN RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
 IF kind IN('session','failure') THEN
  PERFORM app.finish_openwa_base_operation(p_ws,p_connection,p_token,p_fence,p_result);RETURN;
 ELSIF kind='key' AND q.stage='key' AND q.desired_state='connected' THEN
  IF q.remote_session_id IS NULL OR p_result->>'keyId' IS NULL OR jsonb_typeof(p_result->'envelope')<>'object' OR NOT(p_result->'envelope' ?& ARRAY['keyId','iv','tag','ciphertext']) OR(p_result-'kind'-'keyId'-'envelope')<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
  UPDATE app.channel_connection SET identifiers=jsonb_build_object('sessionId',q.remote_session_id),external_account_id=q.remote_session_id::text WHERE workspace_id=p_ws AND id=p_connection;
  UPDATE app.channel_credential SET envelope=p_result->'envelope',identifiers=jsonb_build_object('sessionId',q.remote_session_id),verified_account_id=q.remote_session_id::text WHERE workspace_id=p_ws AND connection_id=p_connection AND revision=q.revision;
  UPDATE app.openwa_connection SET api_key_id=(p_result->>'keyId')::uuid,stage='webhook',attempts=0,error_code=NULL WHERE workspace_id=p_ws AND connection_id=p_connection;
 ELSIF kind='webhook' AND q.stage='webhook' AND q.desired_state='connected' THEN
  IF q.api_key_id IS NULL OR p_result->>'webhookId' IS NULL OR(p_result-'kind'-'webhookId')<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
  UPDATE app.openwa_connection SET webhook_id=(p_result->>'webhookId')::uuid,webhook_registered=true,stage=CASE WHEN restart_requested THEN 'stop' ELSE 'start' END,attempts=0,error_code=NULL WHERE workspace_id=p_ws AND connection_id=p_connection;
 ELSIF kind='stopped' AND q.stage='stop' AND q.desired_state='connected' THEN
  IF(p_result-'kind')<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
  UPDATE app.openwa_connection SET stage='start',restart_requested=false,attempts=0,error_code=NULL WHERE workspace_id=p_ws AND connection_id=p_connection;
 ELSIF kind='started' AND q.stage='start' AND q.desired_state='connected' THEN
  IF NOT q.webhook_registered OR q.api_key_id IS NULL OR(p_result-'kind')<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
  UPDATE app.openwa_connection SET stage='observe',attempts=0,error_code=NULL WHERE workspace_id=p_ws AND connection_id=p_connection;
 ELSIF kind='status' AND q.stage='observe' AND q.desired_state='connected' THEN
  v_phase:=p_result->>'phase';v_phone:=p_result->>'phone';
  IF v_phase IS NULL OR v_phase NOT IN('provisioning','qr_ready','authenticating','ready','disconnected','action_required','failed') OR(v_phone IS NOT NULL AND v_phone!~'^\+[0-9]{6,15}$') OR jsonb_typeof(p_result->'engineLoaded')<>'boolean' OR jsonb_typeof(p_result->'restricted')<>'boolean' OR(p_result-'kind'-'phase'-'phone'-'engineLoaded'-'restricted')<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
  v_ready:=v_phase='ready' AND v_phone IS NOT NULL AND(p_result->>'engineLoaded')::boolean AND NOT(p_result->>'restricted')::boolean AND q.webhook_registered AND q.webhook_id IS NOT NULL AND q.api_key_id IS NOT NULL;
  IF v_phase='ready' AND NOT v_ready THEN v_phase:='action_required';END IF;
  IF(p_result->>'restricted')::boolean THEN v_phase:='action_required';v_ready:=false;END IF;
  UPDATE app.openwa_connection SET phase=v_phase,phone=v_phone,last_checked_at=clock_timestamp(),attempts=0,error_code=CASE WHEN(p_result->>'restricted')::boolean THEN 'OPENWA_ACCOUNT_RESTRICTED' WHEN v_phase IN('action_required','failed') THEN 'OPENWA_SESSION_ACTION_REQUIRED' ELSE NULL END,
   next_at=clock_timestamp()+CASE WHEN v_phase IN('qr_ready','authenticating','provisioning') THEN interval '3 seconds' WHEN v_phase='ready' THEN interval '30 seconds' ELSE interval '60 seconds' END WHERE workspace_id=p_ws AND connection_id=p_connection;
  UPDATE app.channel_connection SET state=CASE WHEN v_ready THEN 'ready' WHEN v_phase IN('action_required','failed','disconnected') THEN 'attention' ELSE 'pending' END,credentials_verified=v_ready,last_error=CASE WHEN v_phase='action_required' THEN 'OPENWA_SESSION_ACTION_REQUIRED' ELSE NULL END,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_connection;
  UPDATE app.channel_sender SET ready=false WHERE workspace_id=p_ws AND connection_id=p_connection;
  IF v_ready THEN
   INSERT INTO app.channel_sender(workspace_id,id,connection_id,provider,address,external_id,identity_scope,ready,daily_limit,capabilities)
    VALUES(p_ws,gen_random_uuid()::text,p_connection,'openwa',v_phone,v_phone,'openwa:'||p_connection,true,20,jsonb_build_object('connectable',true,'requiresServiceWindow',false,'supportsOfficialTemplates',false,'supportsText',true))
    ON CONFLICT(workspace_id,connection_id,external_id) DO UPDATE SET address=EXCLUDED.address,ready=true,capabilities=EXCLUDED.capabilities;
  END IF;
 ELSIF kind='logout' AND q.stage='logout' AND q.desired_state='disconnected' THEN
  IF jsonb_typeof(p_result->'confirmed')<>'boolean' OR(p_result-'kind'-'confirmed')<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
  UPDATE app.openwa_connection SET stage='revoke',error_code=CASE WHEN(p_result->>'confirmed')::boolean THEN NULL ELSE 'OPENWA_UNLINK_UNCONFIRMED' END WHERE workspace_id=p_ws AND connection_id=p_connection;
 ELSIF kind='revoked' AND q.stage='revoke' AND q.desired_state='disconnected' THEN
  IF(p_result-'kind')<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
  UPDATE app.openwa_connection SET stage='idle',phase=CASE WHEN error_code IS NULL THEN 'disconnected' ELSE 'action_required' END,api_key_id=NULL,phone=NULL,webhook_registered=false,attempts=0 WHERE workspace_id=p_ws AND connection_id=p_connection;
 ELSE RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
 UPDATE app.openwa_connection SET lease_token=NULL,lease_until=NULL,lease_revision=NULL,updated_at=clock_timestamp(),next_at=CASE WHEN kind='status' THEN next_at ELSE clock_timestamp() END WHERE workspace_id=p_ws AND connection_id=p_connection;
END $$;
REVOKE ALL ON FUNCTION app.finish_openwa_operation(text,text,text,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finish_openwa_operation(text,text,text,bigint,jsonb) TO cadence_dispatcher;
