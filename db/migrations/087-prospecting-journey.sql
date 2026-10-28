CREATE TABLE app.prospecting_journey(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,actor_id text NOT NULL,
 request_id text NOT NULL,body_hash text NOT NULL,input jsonb NOT NULL,basis jsonb NOT NULL,
 revision bigint NOT NULL DEFAULT 0,state text NOT NULL DEFAULT 'running' CHECK(state IN('running','paused','blocked','review','ready')),
 list_id text,proposal_job_id text,cadence_id text,reason text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,request_id),
 FOREIGN KEY(workspace_id,list_id) REFERENCES app.list(workspace_id,id),
 FOREIGN KEY(workspace_id,proposal_job_id) REFERENCES app.prospecting_job(workspace_id,id),
 FOREIGN KEY(workspace_id,cadence_id) REFERENCES app.cadence(workspace_id,id)
);
CREATE TABLE app.journey_stage(
 workspace_id text NOT NULL,journey_id text NOT NULL,id text NOT NULL,name text NOT NULL CHECK(name IN('discover','research','people','qualify','review','cadence')),
 version integer NOT NULL DEFAULT 1,company_ids text[] NOT NULL DEFAULT '{}',job_id text NOT NULL,state text NOT NULL DEFAULT 'queued',
 missing text[] NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,job_id),UNIQUE(workspace_id,journey_id,name,version,company_ids),
 FOREIGN KEY(workspace_id,journey_id) REFERENCES app.prospecting_journey(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id)
);
CREATE INDEX journey_history ON app.prospecting_journey(workspace_id,created_at DESC,id);
CREATE INDEX journey_stage_order ON app.journey_stage(workspace_id,journey_id,created_at,id);
CREATE FUNCTION app.journey_worker_lease(p_ws text,p_journey text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p_ws=current_setting('app.workspace_id',true) AND EXISTS(
 SELECT 1 FROM app.journey_stage s JOIN app.prospecting_job j ON j.workspace_id=s.workspace_id AND j.id=s.job_id
 JOIN app.prospecting_journey q ON q.workspace_id=s.workspace_id AND q.id=s.journey_id
 WHERE s.workspace_id=p_ws AND s.journey_id=p_journey AND j.id=current_setting('app.journey_job',true)
 AND j.actor_id=current_setting('app.user_id',true) AND q.actor_id=j.actor_id
 AND j.lease_token=current_setting('app.journey_token',true) AND j.fence::text=current_setting('app.journey_fence',true)
 AND j.lease_until>clock_timestamp() AND EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=p_ws AND m."userId"=j.actor_id AND m.role IN('owner','admin','operator')))
$$;
REVOKE ALL ON FUNCTION app.journey_worker_lease(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.journey_worker_lease(text,text) TO cadence_worker;
ALTER TABLE app.prospecting_journey ENABLE ROW LEVEL SECURITY;ALTER TABLE app.prospecting_journey FORCE ROW LEVEL SECURITY;
ALTER TABLE app.journey_stage ENABLE ROW LEVEL SECURITY;ALTER TABLE app.journey_stage FORCE ROW LEVEL SECURITY;
CREATE POLICY journey_read ON app.prospecting_journey FOR SELECT TO cadence_app,cadence_worker USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
CREATE POLICY stage_read ON app.journey_stage FOR SELECT TO cadence_app,cadence_worker USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
CREATE POLICY journey_app ON app.prospecting_journey FOR ALL TO cadence_app USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin','operator')) WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND actor_id=current_setting('app.user_id',true) AND app.current_role() IN('owner','admin','operator'));
CREATE POLICY stage_app ON app.journey_stage FOR ALL TO cadence_app USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin','operator')) WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin','operator') AND EXISTS(SELECT 1 FROM app.prospecting_journey q WHERE q.workspace_id=journey_stage.workspace_id AND q.id=journey_stage.journey_id AND q.actor_id=current_setting('app.user_id',true)));
CREATE POLICY journey_worker ON app.prospecting_journey FOR UPDATE TO cadence_worker USING(app.journey_worker_lease(workspace_id,id)) WITH CHECK(app.journey_worker_lease(workspace_id,id));
CREATE POLICY stage_worker ON app.journey_stage FOR ALL TO cadence_worker USING(app.journey_worker_lease(workspace_id,journey_id)) WITH CHECK(app.journey_worker_lease(workspace_id,journey_id));
GRANT SELECT,INSERT,UPDATE ON app.prospecting_journey,app.journey_stage TO cadence_app;
GRANT SELECT ON app.prospecting_journey,app.journey_stage TO cadence_worker;
GRANT UPDATE(state,revision,reason) ON app.prospecting_journey TO cadence_worker;
GRANT INSERT,UPDATE ON app.journey_stage TO cadence_worker;
-- Reclaim a finished child after a crash between completion and orchestration.
-- The original actor and current membership remain authoritative.
CREATE FUNCTION app.claim_journey_advance(p_workspace text DEFAULT NULL) RETURNS TABLE(workspace_id text,job_id text,actor_id text,token text,expires_at timestamptz,fence bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE child app.prospecting_job;ticket text:=gen_random_uuid()::text;
BEGIN
 SELECT j.* INTO child FROM app.prospecting_job j JOIN app.journey_stage s ON s.workspace_id=j.workspace_id AND s.job_id=j.id
 JOIN app.prospecting_journey q ON q.workspace_id=s.workspace_id AND q.id=s.journey_id
 WHERE q.state='running' AND s.state NOT IN('completed','partial','failed','cancelled','needs_reconciliation')
 AND j.state IN('completed','partial','failed','cancelled','needs_reconciliation') AND (j.lease_until IS NULL OR j.lease_until<=clock_timestamp())
 AND (p_workspace IS NULL OR j.workspace_id=p_workspace) AND q.actor_id=j.actor_id
 AND EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=q.workspace_id AND m."userId"=q.actor_id AND m.role IN('owner','admin','operator'))
 AND NOT EXISTS(SELECT 1 FROM app.prospecting_job active WHERE active.workspace_id=j.workspace_id AND active.lease_until>clock_timestamp() AND active.state IN('running','waiting_provider','cancelling'))
 ORDER BY j.updated_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1;
 IF child.id IS NULL THEN RETURN;END IF;
 RETURN QUERY UPDATE app.prospecting_job j SET lease_token=ticket,lease_until=clock_timestamp()+interval '60 seconds',fence=j.fence+1 WHERE j.workspace_id=child.workspace_id AND j.id=child.id RETURNING j.workspace_id,j.id,j.actor_id,j.lease_token,j.lease_until,j.fence;
END $$;
REVOKE ALL ON FUNCTION app.claim_journey_advance(text) FROM PUBLIC,cadence_app;
GRANT EXECUTE ON FUNCTION app.claim_journey_advance(text) TO cadence_worker;
