CREATE TABLE app.prospecting_cache(workspace_id text NOT NULL,key text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,key));
ALTER TABLE app.prospecting_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.prospecting_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON app.prospecting_cache USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL) WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT,INSERT,UPDATE ON app.prospecting_cache TO cadence_worker;
CREATE FUNCTION app.codex_prospecting_slot(p_job text,p_token text,p_fence bigint,p_release boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true); slot app.provider_slot;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('cadence-prospecting-codex'));
 IF p_release THEN DELETE FROM app.provider_slot WHERE resource_id='codex-local' AND job_id=p_job AND lease_token=p_token; RETURN FOUND; END IF;
 IF app.current_role() IS NULL OR NOT EXISTS(SELECT 1 FROM app.prospecting_job j WHERE j.workspace_id=ws AND j.id=p_job AND j.actor_id=current_setting('app.user_id',true) AND j.lease_token=p_token AND j.fence=p_fence AND j.lease_until>now() AND j.state IN('running','waiting_provider')) THEN RETURN false; END IF;
 SELECT * INTO slot FROM app.provider_slot WHERE resource_id='codex-local' AND slot=1 FOR UPDATE;
 IF FOUND AND slot.lease_until>now() THEN RETURN false; END IF;
 INSERT INTO app.provider_slot VALUES('codex-local',1,ws,p_job,p_token,now()+interval '150 seconds') ON CONFLICT(resource_id,slot) DO UPDATE SET workspace_id=EXCLUDED.workspace_id,job_id=EXCLUDED.job_id,lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.codex_prospecting_slot(text,text,bigint,boolean) FROM PUBLIC,cadence_app;
GRANT EXECUTE ON FUNCTION app.codex_prospecting_slot(text,text,bigint,boolean) TO cadence_worker;
