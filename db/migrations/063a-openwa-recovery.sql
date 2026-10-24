CREATE TABLE app.openwa_recovery(
 workspace_id text NOT NULL,connection_id text NOT NULL,revision bigint NOT NULL,checkpoint timestamptz NOT NULL,window_until timestamptz,cursor uuid,pages integer NOT NULL DEFAULT 0,
 next_at timestamptz NOT NULL DEFAULT clock_timestamp(),lease_token text,lease_until timestamptz,fence bigint NOT NULL DEFAULT 0,failures integer NOT NULL DEFAULT 0,error_code text,
 PRIMARY KEY(workspace_id,connection_id),FOREIGN KEY(workspace_id,connection_id) REFERENCES app.openwa_connection(workspace_id,connection_id)
);
CREATE TABLE app.openwa_receipt_check(workspace_id text NOT NULL,message_id text NOT NULL,next_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,message_id),FOREIGN KEY(workspace_id,message_id) REFERENCES app.channel_message(workspace_id,id));
ALTER TABLE app.openwa_recovery ENABLE ROW LEVEL SECURITY;ALTER TABLE app.openwa_recovery FORCE ROW LEVEL SECURITY;
ALTER TABLE app.openwa_receipt_check ENABLE ROW LEVEL SECURITY;ALTER TABLE app.openwa_receipt_check FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.openwa_recovery,app.openwa_receipt_check FROM PUBLIC,cadence_app,cadence_dispatcher,cadence_ingress;
CREATE FUNCTION app.claim_openwa_recovery(p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app.openwa_connection;r app.openwa_recovery;token text;
BEGIN
 IF p_now IS NULL OR NOT isfinite(p_now) THEN RAISE EXCEPTION 'INVALID_OPENWA_CLOCK';END IF;
 INSERT INTO app.openwa_recovery(workspace_id,connection_id,revision,checkpoint,next_at)
 SELECT o.workspace_id,o.connection_id,o.revision,o.messages_since-interval '2 seconds',p_now FROM app.openwa_connection o WHERE o.phase='ready' AND o.desired_state='connected' AND NOT o.automation_paused AND NOT EXISTS(SELECT 1 FROM app.openwa_recovery existing WHERE existing.workspace_id=o.workspace_id AND existing.connection_id=o.connection_id) ORDER BY o.created_at LIMIT 5 ON CONFLICT DO NOTHING;
 SELECT o.* INTO q FROM app.openwa_connection o JOIN app.channel_connection c ON c.workspace_id=o.workspace_id AND c.id=o.connection_id JOIN app.openwa_recovery job ON job.workspace_id=o.workspace_id AND job.connection_id=o.connection_id
 WHERE o.phase='ready' AND o.desired_state='connected' AND NOT o.automation_paused AND o.revision=c.revision AND c.credentials_verified AND c.state='ready' AND job.next_at<=p_now AND(job.lease_until IS NULL OR job.lease_until<clock_timestamp())
 AND EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=o.workspace_id AND m."userId"=o.requested_by AND m.role IN('owner','admin'))
 ORDER BY job.next_at,o.connection_id LIMIT 1 FOR UPDATE OF job SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;token:=gen_random_uuid()::text;
 UPDATE app.openwa_recovery SET checkpoint=CASE WHEN revision<>q.revision THEN p_now-interval '60 seconds' ELSE checkpoint END,window_until=CASE WHEN revision<>q.revision THEN p_now ELSE COALESCE(window_until,p_now) END,cursor=CASE WHEN revision<>q.revision THEN NULL ELSE cursor END,pages=CASE WHEN revision<>q.revision THEN 0 ELSE pages END,revision=q.revision,lease_token=token,lease_until=clock_timestamp()+interval '60 seconds',fence=fence+1 WHERE workspace_id=q.workspace_id AND connection_id=q.connection_id RETURNING * INTO r;
 RETURN jsonb_build_object('workspaceId',q.workspace_id,'connectionId',q.connection_id,'revision',q.revision,'token',token,'fence',r.fence);
END $$;
CREATE FUNCTION app.read_openwa_recovery(p_ws text,p_connection text,p_token text,p_fence bigint,p_receipts integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.openwa_recovery;q app.openwa_connection;c app.channel_connection;cred app.channel_credential;receipts jsonb;senders jsonb;
BEGIN
 IF p_receipts NOT BETWEEN 0 AND 20 THEN RAISE EXCEPTION 'INVALID_RECOVERY_SCOPE';END IF;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=p_ws AND id=p_connection FOR SHARE;
 SELECT * INTO q FROM app.openwa_connection WHERE workspace_id=p_ws AND connection_id=p_connection FOR SHARE;
 SELECT * INTO r FROM app.openwa_recovery WHERE workspace_id=p_ws AND connection_id=p_connection AND lease_token=p_token AND fence=p_fence AND lease_until>clock_timestamp() AND revision=c.revision FOR UPDATE;
 IF NOT FOUND OR c.provider<>'openwa' OR c.state<>'ready' OR NOT c.credentials_verified OR q.desired_state<>'connected' OR q.phase<>'ready' OR q.automation_paused OR q.revision<>c.revision OR NOT q.webhook_registered OR NOT EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=p_ws AND m."userId"=q.requested_by AND m.role IN('owner','admin')) THEN RAISE EXCEPTION 'STALE_OPENWA_RECOVERY';END IF;
 SELECT * INTO cred FROM app.channel_credential WHERE workspace_id=p_ws AND connection_id=p_connection AND revision=c.revision AND verified_account_id=q.remote_session_id::text;
 IF NOT FOUND THEN RAISE EXCEPTION 'OPENWA_CREDENTIAL_MISSING';END IF;
 INSERT INTO app.openwa_receipt_check(workspace_id,message_id) SELECT workspace_id,id FROM app.channel_message WHERE workspace_id=p_ws AND connection_id=p_connection AND direction='outbound' AND state IN('accepted','delivered') AND remote_id IS NOT NULL AND created_at>clock_timestamp()-interval '7 days' ON CONFLICT DO NOTHING;
 SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]') INTO receipts FROM(SELECT m.id,m.remote_id,i.external_id FROM app.openwa_receipt_check z JOIN app.channel_message m ON m.workspace_id=z.workspace_id AND m.id=z.message_id JOIN app.channel_identity i ON i.workspace_id=m.workspace_id AND i.id=m.identity_id WHERE z.workspace_id=p_ws AND m.connection_id=p_connection AND m.state IN('accepted','delivered') AND z.next_at<=clock_timestamp() ORDER BY z.next_at,m.id LIMIT p_receipts) x;
 UPDATE app.openwa_receipt_check SET next_at=clock_timestamp()+interval '15 seconds' WHERE workspace_id=p_ws AND message_id IN(SELECT v->>'id' FROM jsonb_array_elements(receipts) v);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('externalId',external_id,'address',address)),'[]') INTO senders FROM app.channel_sender WHERE workspace_id=p_ws AND connection_id=p_connection AND ready;
 RETURN jsonb_build_object('connection',to_jsonb(c),'recovery',to_jsonb(r),'envelope',cred.envelope,'senders',senders,'receipts',receipts);
END $$;
CREATE FUNCTION app.finish_openwa_recovery(p_ws text,p_connection text,p_token text,p_fence bigint,p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.openwa_recovery;q app.openwa_connection;c app.channel_connection;before_id bigint;code text;
BEGIN
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=p_ws AND id=p_connection FOR SHARE;
 SELECT * INTO q FROM app.openwa_connection WHERE workspace_id=p_ws AND connection_id=p_connection FOR UPDATE;
 SELECT * INTO r FROM app.openwa_recovery WHERE workspace_id=p_ws AND connection_id=p_connection AND lease_token=p_token AND fence=p_fence AND lease_until>clock_timestamp() AND revision=c.revision FOR UPDATE;
 IF NOT FOUND OR q.desired_state<>'connected' OR q.phase<>'ready' OR q.automation_paused OR q.revision<>c.revision OR NOT c.credentials_verified OR c.state<>'ready' OR NOT EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=p_ws AND m."userId"=q.requested_by AND m.role IN('owner','admin')) THEN RETURN false;END IF;
 IF p_result->>'kind'='failure' THEN
  code:=left(p_result->>'code',100);UPDATE app.openwa_recovery SET failures=failures+1,error_code=code,next_at=clock_timestamp()+make_interval(secs=>LEAST(300,15*power(2,LEAST(failures+1,5)))) ,lease_until=NULL WHERE workspace_id=p_ws AND connection_id=p_connection;
  IF r.failures<4 AND code<>'OPENWA_RECOVERY_GAP' THEN RETURN true;END IF;
  UPDATE app.openwa_connection SET automation_paused=true,phase='action_required',error_code=CASE WHEN code='OPENWA_RECOVERY_GAP' THEN code ELSE 'OPENWA_RECOVERY_FAILED' END WHERE workspace_id=p_ws AND connection_id=p_connection;
  UPDATE app.channel_connection SET state='attention',last_error=CASE WHEN code='OPENWA_RECOVERY_GAP' THEN code ELSE 'OPENWA_RECOVERY_FAILED' END WHERE workspace_id=p_ws AND id=p_connection;
  UPDATE app.channel_sender SET ready=false WHERE workspace_id=p_ws AND connection_id=p_connection;RETURN true;
 END IF;
 IF p_result->>'kind'<>'page' OR pg_column_size(p_result)>1048576 OR jsonb_array_length(p_result->'events')>40 THEN RAISE EXCEPTION 'INVALID_RECOVERY_RESULT';END IF;
 SELECT COALESCE(max(id),0) INTO before_id FROM app.channel_received_event WHERE workspace_id=p_ws AND connection_id=p_connection;
 PERFORM app.ingest_channel_batch(jsonb_build_object('connectionId',p_connection,'credentialRevision',r.revision,'bodyHash',NULL,'receivedAt',clock_timestamp(),'events',p_result->'events'));
 UPDATE app.channel_received_event SET event_metadata=event_metadata||jsonb_build_object('source','gateway-read') WHERE workspace_id=p_ws AND connection_id=p_connection AND id>before_id;
 IF p_result->>'cursor' IS NOT NULL AND (r.pages>=4 OR p_result->>'cursor'=r.cursor::text) THEN RAISE EXCEPTION 'OPENWA_RECOVERY_GAP';END IF;
 UPDATE app.openwa_recovery SET checkpoint=CASE WHEN p_result->>'cursor' IS NULL THEN r.window_until-interval '2 seconds' ELSE checkpoint END,window_until=CASE WHEN p_result->>'cursor' IS NULL THEN NULL ELSE window_until END,cursor=(p_result->>'cursor')::uuid,pages=CASE WHEN p_result->>'cursor' IS NULL THEN 0 ELSE pages+1 END,next_at=clock_timestamp()+interval '15 seconds',failures=0,error_code=NULL,lease_until=NULL WHERE workspace_id=p_ws AND connection_id=p_connection;
 UPDATE app.openwa_connection SET messages_since=CASE WHEN p_result->>'cursor' IS NULL THEN r.window_until-interval '2 seconds' ELSE messages_since END,messages_cursor=p_result->>'cursor' WHERE workspace_id=p_ws AND connection_id=p_connection;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.claim_openwa_recovery(timestamptz),app.read_openwa_recovery(text,text,text,bigint,integer),app.finish_openwa_recovery(text,text,text,bigint,jsonb) FROM PUBLIC,cadence_app,cadence_ingress;
GRANT EXECUTE ON FUNCTION app.claim_openwa_recovery(timestamptz),app.read_openwa_recovery(text,text,text,bigint,integer),app.finish_openwa_recovery(text,text,text,bigint,jsonb) TO cadence_dispatcher;
