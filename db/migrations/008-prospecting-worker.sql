GRANT USAGE ON SCHEMA app TO cadence_worker;
GRANT SELECT,UPDATE ON app.workspace_meta TO cadence_worker;
GRANT SELECT ON app.list,app.context_version,app.prospecting_policy TO cadence_worker;
GRANT SELECT,INSERT,UPDATE ON app.lead,app.lead_identity,app.identity_collision,app.lead_evidence,app.prospecting_receipt,app.prospecting_job,app.prospecting_item,app.prospecting_attempt,app.usage_ledger TO cadence_worker;
GRANT DELETE ON app.lead_identity TO cadence_worker;
GRANT EXECUTE ON FUNCTION app.current_role(),app.lock_membership() TO cadence_worker;
CREATE FUNCTION app.claim_prospecting_job(p_worker text,p_limit integer,p_workspace text DEFAULT NULL) RETURNS TABLE(workspace_id text,job_id text,actor_id text,token text,expires_at timestamptz,fence bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job app.prospecting_job; new_token text:=gen_random_uuid()::text;
BEGIN
 IF length(p_worker)<1 OR length(p_worker)>120 OR p_limit<1 OR p_limit>32 THEN RAISE EXCEPTION 'INVALID_WORKER'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('cadence-prospecting-claim'));
 IF (SELECT count(*) FROM app.prospecting_job j WHERE j.lease_until>now() AND j.state IN('running','waiting_provider','cancelling'))>=p_limit THEN RETURN; END IF;
 SELECT j.* INTO job FROM app.prospecting_job j
 WHERE (p_workspace IS NULL OR j.workspace_id=p_workspace)
 AND j.state IN('queued','running','waiting_provider','cancelling') AND (j.lease_until IS NULL OR j.lease_until<now())
 AND EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=j.workspace_id AND m."userId"=j.actor_id)
 AND NOT EXISTS(SELECT 1 FROM app.prospecting_job other WHERE other.workspace_id=j.workspace_id AND other.id<>j.id AND other.lease_until>now() AND other.state IN('running','waiting_provider','cancelling'))
 ORDER BY j.created_at,j.id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE app.prospecting_job j SET state=CASE WHEN j.state='queued' THEN 'running' ELSE j.state END,lease_owner=p_worker,lease_token=new_token,lease_until=now()+interval '60 seconds',fence=j.fence+1,updated_at=now() WHERE j.workspace_id=job.workspace_id AND j.id=job.id
 RETURNING j.workspace_id,j.id,j.actor_id,j.lease_token,j.lease_until,j.fence INTO workspace_id,job_id,actor_id,token,expires_at,fence;
 RETURN NEXT;
END $$;
CREATE FUNCTION app.heartbeat_prospecting_job(p_job text,p_token text,p_fence bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.prospecting_job j SET lease_until=now()+interval '60 seconds' WHERE j.id=p_job AND j.lease_token=p_token AND j.fence=p_fence AND j.lease_until>now() AND j.state IN('running','waiting_provider','cancelling') AND EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=j.workspace_id AND m."userId"=j.actor_id);
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION app.claim_prospecting_job(text,integer,text),app.heartbeat_prospecting_job(text,text,bigint) FROM PUBLIC,cadence_app;
GRANT EXECUTE ON FUNCTION app.claim_prospecting_job(text,integer,text),app.heartbeat_prospecting_job(text,text,bigint) TO cadence_worker;
