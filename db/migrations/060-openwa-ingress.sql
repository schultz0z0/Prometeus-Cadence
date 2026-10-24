ALTER TABLE app.openwa_connection ADD COLUMN last_event_at timestamptz;
ALTER TABLE app.openwa_connection ADD COLUMN automation_paused boolean NOT NULL DEFAULT false;
-- Preserve the current Meta/mail implementation, including earlier upgrades, while changing only
-- the identity namespace and readiness side effects that differ for a managed session.
DO $$ DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('app.ingest_channel_batch(jsonb)'::regprocedure) INTO definition;
 IF position('conn.provider||'':''||cred.verified_account_id' IN definition)=0 OR position('UPDATE app.channel_connection SET inbound_verified=true,state=''ready''' IN definition)=0 THEN RAISE EXCEPTION 'OPENWA_INGRESS_UPGRADE_REQUIRED';END IF;
 definition:=replace(definition,'conn.provider||'':''||cred.verified_account_id','(CASE WHEN conn.provider=''openwa'' THEN ''openwa:''||conn.id ELSE conn.provider||'':''||cred.verified_account_id END)');
 definition:=replace(definition,'is_current:=conn.revision=cred.revision AND conn.credentials_verified AND conn.state NOT IN(''disconnected'',''pending'');','is_current:=conn.revision=cred.revision AND conn.credentials_verified AND conn.state NOT IN(''disconnected'',''pending'') AND (conn.provider<>''openwa'' OR EXISTS(SELECT 1 FROM app.openwa_connection o WHERE o.workspace_id=conn.workspace_id AND o.connection_id=conn.id AND o.desired_state=''connected'' AND o.phase=''ready'' AND NOT o.automation_paused));');
 definition:=replace(definition,'UPDATE app.channel_connection SET inbound_verified=true,state=''ready'' WHERE workspace_id=conn.workspace_id AND id=conn.id;','UPDATE app.channel_connection SET inbound_verified=true,state=CASE WHEN provider=''openwa'' THEN state ELSE ''ready'' END WHERE workspace_id=conn.workspace_id AND id=conn.id;');
 definition:=replace(definition,'UPDATE app.channel_sender SET ready=true WHERE workspace_id=conn.workspace_id AND id=sender.id;','UPDATE app.channel_sender SET ready=true WHERE workspace_id=conn.workspace_id AND id=sender.id AND conn.provider<>''openwa'';');
 EXECUTE definition;
END $$;
ALTER FUNCTION app.ingest_channel_batch(jsonb) RENAME TO ingest_channel_base_batch;
REVOKE ALL ON FUNCTION app.ingest_channel_base_batch(jsonb) FROM PUBLIC,cadence_ingress;
CREATE FUNCTION app.ingest_channel_batch(p_batch jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE conn app.channel_connection;cred app.channel_credential;q app.openwa_connection;event jsonb;remaining jsonb:='[]';result jsonb;ev_id bigint;at timestamptz;stored integer:=0;duplicates integer:=0;
BEGIN
 SELECT * INTO conn FROM app.channel_connection WHERE id=p_batch->>'connectionId';IF NOT FOUND THEN RAISE EXCEPTION 'CHANNEL_NOT_FOUND';END IF;
 IF conn.provider<>'openwa' THEN RETURN app.ingest_channel_base_batch(p_batch);END IF;
 IF pg_column_size(p_batch)>2097152 OR jsonb_typeof(p_batch->'events')<>'array' OR jsonb_array_length(p_batch->'events')>2000 THEN RAISE EXCEPTION 'INVALID_BATCH';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=conn.workspace_id FOR UPDATE;
 SELECT * INTO conn FROM app.channel_connection WHERE id=conn.id FOR UPDATE;
 SELECT * INTO q FROM app.openwa_connection WHERE workspace_id=conn.workspace_id AND connection_id=conn.id FOR UPDATE;
 SELECT * INTO cred FROM app.channel_credential WHERE workspace_id=conn.workspace_id AND connection_id=conn.id AND revision=(p_batch->>'credentialRevision')::bigint;
 IF NOT FOUND OR cred.verified_account_id IS NULL OR cred.verified_account_id IS DISTINCT FROM q.remote_session_id::text THEN RAISE EXCEPTION 'UNVERIFIED_CHANNEL';END IF;
 FOR event IN SELECT value FROM jsonb_array_elements(p_batch->'events') LOOP
  IF event->>'accountId' IS DISTINCT FROM cred.verified_account_id THEN RAISE EXCEPTION 'CALLBACK_ACCOUNT_MISMATCH';END IF;
  IF event->>'kind'<>'session' THEN remaining:=remaining||jsonb_build_array(event);CONTINUE;END IF;
  IF conn.revision<>cred.revision OR q.desired_state<>'connected' OR q.stage<>'observe' OR NOT q.webhook_registered THEN CONTINUE;END IF;
  at:=(event->>'occurredAt')::timestamptz;
  IF length(event->>'dedupKey')<>64 OR at IS NULL OR NOT isfinite(at) OR at>clock_timestamp()+interval '5 minutes' OR(event->>'phase') NOT IN('created','initializing','provisioning','qr_ready','authenticating','ready','disconnected','action_required','failed','observe') OR jsonb_typeof(event->'restricted')<>'boolean' THEN RAISE EXCEPTION 'INVALID_OPENWA_SESSION_EVENT';END IF;
  INSERT INTO app.channel_received_event(workspace_id,connection_id,credential_revision,dedup_key,body_hash,kind,event_metadata)
   VALUES(conn.workspace_id,conn.id,cred.revision,event->>'dedupKey',p_batch->>'bodyHash','session',event)
   ON CONFLICT(workspace_id,connection_id,dedup_key) DO NOTHING RETURNING id INTO ev_id;
  IF NOT FOUND THEN duplicates:=duplicates+1;CONTINUE;END IF;stored:=stored+1;
  IF at<COALESCE(q.last_event_at,'-infinity'::timestamptz) OR at<COALESCE(q.last_checked_at,'-infinity'::timestamptz)-interval '2 seconds' THEN CONTINUE;END IF;
  UPDATE app.openwa_connection SET last_event_at=at,next_at=LEAST(next_at,clock_timestamp()) WHERE workspace_id=conn.workspace_id AND connection_id=conn.id;
  -- Positive events only schedule an authenticated REST check. Negative evidence blocks immediately.
  IF(event->>'restricted')::boolean OR event->>'phase' IN('disconnected','action_required','failed') THEN
   UPDATE app.openwa_connection SET phase=CASE WHEN(event->>'restricted')::boolean THEN 'action_required' ELSE event->>'phase' END,
    automation_paused=automation_paused OR(event->>'restricted')::boolean,error_code=CASE WHEN(event->>'restricted')::boolean THEN 'OPENWA_ACCOUNT_RESTRICTED' ELSE 'OPENWA_SESSION_ACTION_REQUIRED' END WHERE workspace_id=conn.workspace_id AND connection_id=conn.id;
   UPDATE app.channel_connection SET state='attention',credentials_verified=false,last_error='OPENWA_SESSION_ACTION_REQUIRED' WHERE workspace_id=conn.workspace_id AND id=conn.id;
   UPDATE app.channel_sender SET ready=false WHERE workspace_id=conn.workspace_id AND connection_id=conn.id;
  END IF;
 END LOOP;
 result:=app.ingest_channel_base_batch(p_batch||jsonb_build_object('events',remaining));
 RETURN jsonb_build_object('stored',stored+(result->>'stored')::integer,'duplicates',duplicates+(result->>'duplicates')::integer);
END $$;
REVOKE ALL ON FUNCTION app.ingest_channel_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ingest_channel_batch(jsonb) TO cadence_ingress;
-- REST readiness cannot undo a restriction until an administrator explicitly reconnects.
DO $$ DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('app.finish_openwa_operation(text,text,text,bigint,jsonb)'::regprocedure) INTO definition;
 IF position('AND q.webhook_registered' IN definition)=0 THEN RAISE EXCEPTION 'OPENWA_LIFECYCLE_UPGRADE_REQUIRED';END IF;
 definition:=replace(definition,'AND q.webhook_registered','AND NOT q.automation_paused AND q.webhook_registered');EXECUTE definition;
END $$;
