ALTER TABLE app.prospecting_job ALTER COLUMN list_id DROP NOT NULL;
ALTER TABLE app.prospecting_job DROP CONSTRAINT prospecting_job_kind_check;
ALTER TABLE app.prospecting_job ADD CONSTRAINT prospecting_job_kind_check CHECK(kind IN('generation','qualification','planning'));
ALTER TABLE app.prospecting_job ADD CONSTRAINT prospecting_job_list_required CHECK(kind='planning' OR list_id IS NOT NULL);

CREATE TABLE app.planning_evidence (
 workspace_id text NOT NULL,job_id text NOT NULL,id text NOT NULL,body_hash text NOT NULL,payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,job_id,id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id)
);
CREATE TABLE app.planning_proposal (
 workspace_id text NOT NULL,job_id text NOT NULL,body_hash text NOT NULL,payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,job_id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id)
);
CREATE TABLE app.planning_confirmation (
 workspace_id text NOT NULL,job_id text NOT NULL,request_id text NOT NULL,actor_id text NOT NULL REFERENCES auth."user"(id),
 body_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,job_id),UNIQUE(workspace_id,request_id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES app.planning_proposal(workspace_id,job_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['planning_evidence','planning_proposal','planning_confirmation'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker',t);
  EXECUTE format('CREATE POLICY workspace_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
  EXECUTE format('GRANT SELECT ON app.%I TO cadence_app,cadence_worker',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['planning_evidence','planning_proposal'] LOOP
  EXECUTE format('CREATE POLICY fenced_worker_write ON app.%I FOR INSERT TO cadence_worker WITH CHECK(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL AND EXISTS(SELECT 1 FROM app.prospecting_job j WHERE j.workspace_id=workspace_id AND j.id=job_id AND j.kind=''planning'' AND j.actor_id=current_setting(''app.user_id'',true) AND j.lease_token=current_setting(''app.planning_lease_token'',true) AND j.fence::text=current_setting(''app.planning_lease_fence'',true) AND j.lease_until>clock_timestamp() AND j.state IN(''running'',''waiting_provider'')))',t);
  EXECUTE format('GRANT INSERT ON app.%I TO cadence_worker',t);
 END LOOP;
END $$;
CREATE POLICY confirmation_write ON app.planning_confirmation FOR INSERT TO cadence_app
 WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND actor_id=current_setting('app.user_id',true) AND app.current_role() IN('owner','admin','operator'));
GRANT INSERT ON app.planning_confirmation TO cadence_app;
