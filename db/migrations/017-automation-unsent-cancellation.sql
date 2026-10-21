-- A queued cancellation has no worker lease. This function can only mirror a
-- cancelled job and release assignments with no journal or result at all.
CREATE FUNCTION app.sync_cancelled_automation_job(p_job text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true); actor text:=current_setting('app.user_id',true); role text:=app.current_role(); job app.prospecting_job;
BEGIN
 SELECT * INTO job FROM app.prospecting_job WHERE workspace_id=ws AND id=p_job FOR UPDATE;
 IF NOT FOUND OR role IS NULL OR (role NOT IN('owner','admin') AND NOT(role='operator' AND job.actor_id=actor)) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF job.state<>'cancelled' THEN RETURN;END IF;
 UPDATE app.automation_occurrence SET state='cancelled',counts=job.counts WHERE workspace_id=ws AND job_id=p_job;
 IF NOT EXISTS(SELECT 1 FROM app.prospecting_attempt WHERE workspace_id=ws AND job_id=p_job)
 AND NOT EXISTS(SELECT 1 FROM app.prospecting_item WHERE workspace_id=ws AND job_id=p_job) THEN
  UPDATE app.automation_lead_assignment SET state='released' WHERE workspace_id=ws AND job_id=p_job AND state='assigned';
 END IF;
END $$;
REVOKE ALL ON FUNCTION app.sync_cancelled_automation_job(text) FROM PUBLIC,cadence_worker;
GRANT EXECUTE ON FUNCTION app.sync_cancelled_automation_job(text) TO cadence_app;
