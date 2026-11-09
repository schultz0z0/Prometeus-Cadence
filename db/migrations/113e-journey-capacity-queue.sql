ALTER TABLE app.prospecting_job ADD COLUMN capacity_retry_at timestamptz;

CREATE OR REPLACE FUNCTION app.claim_prospecting_job_internal(p_worker text,p_limit integer,p_workspace text DEFAULT NULL)
RETURNS TABLE(workspace_id text,job_id text,actor_id text,token text,expires_at timestamptz,fence bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job app.prospecting_job; new_token text:=gen_random_uuid()::text;
BEGIN
 IF length(p_worker)<1 OR length(p_worker)>120 OR p_limit<1 OR p_limit>32 THEN RAISE EXCEPTION 'INVALID_WORKER';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('cadence-prospecting-claim'));
 IF (SELECT count(*) FROM app.prospecting_job j WHERE j.lease_until>now() AND j.state IN('running','waiting_provider','cancelling'))>=p_limit THEN RETURN;END IF;
 SELECT j.* INTO job FROM app.prospecting_job j
 WHERE (p_workspace IS NULL OR j.workspace_id=p_workspace)
 AND j.state IN('queued','running','waiting_provider','cancelling') AND (j.lease_until IS NULL OR j.lease_until<now())
 AND (j.state='cancelling' OR j.capacity_retry_at IS NULL OR j.capacity_retry_at<=now())
 AND NOT app.company_people_actor_revoked(j.workspace_id,j.actor_id,j.input)
 AND NOT EXISTS(SELECT 1 FROM app.prospecting_job other WHERE other.workspace_id=j.workspace_id AND other.id<>j.id AND other.lease_until>now() AND other.state IN('running','waiting_provider','cancelling'))
 ORDER BY j.created_at,j.id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN;END IF;
 UPDATE app.prospecting_job j SET state=CASE WHEN j.state='queued' THEN 'running' ELSE j.state END,
  lease_owner=p_worker,lease_token=new_token,lease_until=now()+interval '60 seconds',fence=j.fence+1,updated_at=now(),capacity_retry_at=NULL,
  error_code=CASE WHEN j.error_code='WAITING_CAPACITY' THEN NULL ELSE j.error_code END,
  error_message=CASE WHEN j.error_code='WAITING_CAPACITY' THEN NULL ELSE j.error_message END
 WHERE j.workspace_id=job.workspace_id AND j.id=job.id
 RETURNING j.workspace_id,j.id,j.actor_id,j.lease_token,j.lease_until,j.fence INTO workspace_id,job_id,actor_id,token,expires_at,fence;
 RETURN NEXT;
END $$;
