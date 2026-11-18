-- 18/11/2026: a number paused because the app lost track of received messages (recovery gap or repeated recovery failure)
-- can be resumed by an owner or admin after checking the phone. Reading starts again from now; pairing and WhatsApp restrictions still need reconnecting.
CREATE FUNCTION app.openwa_resume_sending(p_connection text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);q app.openwa_connection;
BEGIN
 IF app.current_role() IS DISTINCT FROM 'owner' AND app.current_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'OPENWA_RESUME_FORBIDDEN';END IF;
 SELECT * INTO q FROM app.openwa_connection WHERE workspace_id=ws AND connection_id=p_connection FOR UPDATE;
 IF NOT FOUND OR q.desired_state<>'connected' OR NOT q.automation_paused OR q.error_code IS NULL OR q.error_code NOT IN('OPENWA_RECOVERY_GAP','OPENWA_RECOVERY_FAILED') THEN RAISE EXCEPTION 'OPENWA_RESUME_NOT_ALLOWED';END IF;
 UPDATE app.openwa_connection SET automation_paused=false,phase='ready',error_code=NULL,updated_at=clock_timestamp() WHERE workspace_id=ws AND connection_id=p_connection;
 UPDATE app.channel_connection SET state='ready',last_error=NULL,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_connection AND state='attention';
 UPDATE app.openwa_recovery SET checkpoint=clock_timestamp(),window_until=NULL,cursor=NULL,pages=0,failures=0,error_code=NULL,next_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,fence=fence+1
  WHERE workspace_id=ws AND connection_id=p_connection;
END $$;
REVOKE ALL ON FUNCTION app.openwa_resume_sending(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.openwa_resume_sending(text) TO cadence_app;
