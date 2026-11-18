-- 18/11/2026: the periodic gateway check keeps a paused number paused (migration 060) but replaced the reason with
-- OPENWA_SESSION_ACTION_REQUIRED, hiding why it stopped and the "Retomar envios" button. A recovery pause keeps its own reason.
ALTER FUNCTION app.finish_openwa_operation(text,text,text,bigint,jsonb) RENAME TO finish_openwa_operation_pre_pause_reason;
CREATE FUNCTION app.finish_openwa_operation(p_ws text,p_connection text,p_token text,p_fence bigint,p_result jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE before_code text;
BEGIN
 SELECT error_code INTO before_code FROM app.openwa_connection WHERE workspace_id=p_ws AND connection_id=p_connection AND automation_paused FOR UPDATE;
 PERFORM app.finish_openwa_operation_pre_pause_reason(p_ws,p_connection,p_token,p_fence,p_result);
 IF before_code IN('OPENWA_RECOVERY_GAP','OPENWA_RECOVERY_FAILED') THEN
  UPDATE app.openwa_connection SET error_code=before_code WHERE workspace_id=p_ws AND connection_id=p_connection AND automation_paused AND error_code='OPENWA_SESSION_ACTION_REQUIRED';
  UPDATE app.channel_connection SET last_error=before_code WHERE workspace_id=p_ws AND id=p_connection AND last_error='OPENWA_SESSION_ACTION_REQUIRED';
 END IF;
END $$;
REVOKE ALL ON FUNCTION app.finish_openwa_operation_pre_pause_reason(text,text,text,bigint,jsonb),app.finish_openwa_operation(text,text,text,bigint,jsonb) FROM PUBLIC,cadence_app,cadence_dispatcher;
GRANT EXECUTE ON FUNCTION app.finish_openwa_operation(text,text,text,bigint,jsonb) TO cadence_dispatcher;
