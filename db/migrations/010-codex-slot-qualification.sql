-- Additive correction: distinguish the held row from its slot column.
CREATE OR REPLACE FUNCTION app.codex_prospecting_slot(p_job text,p_token text,p_fence bigint,p_release boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true); held app.provider_slot;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('cadence-prospecting-codex'));
 IF p_release THEN DELETE FROM app.provider_slot WHERE resource_id='codex-local' AND job_id=p_job AND lease_token=p_token; RETURN FOUND; END IF;
 IF app.current_role() IS NULL OR NOT EXISTS(SELECT 1 FROM app.prospecting_job j WHERE j.workspace_id=ws AND j.id=p_job AND j.actor_id=current_setting('app.user_id',true) AND j.lease_token=p_token AND j.fence=p_fence AND j.lease_until>now() AND j.state IN('running','waiting_provider')) THEN RETURN false; END IF;
 SELECT s.* INTO held FROM app.provider_slot s WHERE s.resource_id='codex-local' AND s.slot=1 FOR UPDATE;
 IF FOUND AND held.lease_until>now() THEN RETURN false; END IF;
 INSERT INTO app.provider_slot VALUES('codex-local',1,ws,p_job,p_token,now()+interval '150 seconds') ON CONFLICT ON CONSTRAINT provider_slot_pkey DO UPDATE SET workspace_id=EXCLUDED.workspace_id,job_id=EXCLUDED.job_id,lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until;
 RETURN true;
END $$;
