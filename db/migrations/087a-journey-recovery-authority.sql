-- Follow-up: immutable identity, administrative pause, and SQL publication fence.
DROP POLICY journey_app ON app.prospecting_journey;
CREATE POLICY journey_insert ON app.prospecting_journey FOR INSERT TO cadence_app WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND actor_id=current_setting('app.user_id',true) AND app.current_role() IN('owner','admin','operator'));
CREATE POLICY journey_update ON app.prospecting_journey FOR UPDATE TO cadence_app
 USING(workspace_id=current_setting('app.workspace_id',true) AND (actor_id=current_setting('app.user_id',true) AND app.current_role()='operator' OR app.current_role() IN('owner','admin')))
 WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND (actor_id=current_setting('app.user_id',true) AND app.current_role()='operator' OR app.current_role() IN('owner','admin')));
REVOKE UPDATE ON app.prospecting_journey FROM cadence_app;
GRANT UPDATE(state,reason,revision,basis,proposal_job_id,cadence_id) ON app.prospecting_journey TO cadence_app;
DROP POLICY stage_app ON app.journey_stage;
CREATE POLICY stage_app ON app.journey_stage FOR ALL TO cadence_app USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin','operator') AND EXISTS(SELECT 1 FROM app.prospecting_journey q WHERE q.workspace_id=journey_stage.workspace_id AND q.id=journey_stage.journey_id AND (q.actor_id=current_setting('app.user_id',true) OR app.current_role() IN('owner','admin'))))
 WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin','operator') AND EXISTS(SELECT 1 FROM app.prospecting_journey q WHERE q.workspace_id=journey_stage.workspace_id AND q.id=journey_stage.journey_id AND (q.actor_id=current_setting('app.user_id',true) OR app.current_role() IN('owner','admin'))));

CREATE FUNCTION app.journey_database_authority() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN app.current_role() IS NOT NULL THEN jsonb_build_object(
 'context',(SELECT payload FROM app.context_version WHERE workspace_id=current_setting('app.workspace_id',true) AND payload->>'approvedAt' IS NOT NULL AND pg_input_is_valid(payload->>'approvedAt','timestamptz') ORDER BY version DESC LIMIT 1),
 'policy',(SELECT to_jsonb(p)-'workspace_id' FROM app.ai_policy p JOIN app.platform_ai_control ctrl USING(workspace_id) WHERE ctrl.singleton),
 'sourcePolicy',(SELECT to_jsonb(p)-'workspace_id' FROM app.prospecting_policy p WHERE workspace_id=current_setting('app.workspace_id',true))) END
$$;
REVOKE ALL ON FUNCTION app.journey_database_authority() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.journey_database_authority() TO cadence_app,cadence_worker;

CREATE FUNCTION app.guard_journey_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') THEN RETURN NEW;END IF;
 IF ROW(NEW.workspace_id,NEW.id,NEW.actor_id,NEW.request_id,NEW.body_hash,NEW.input,NEW.list_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.workspace_id,OLD.id,OLD.actor_id,OLD.request_id,OLD.body_hash,OLD.input,OLD.list_id,OLD.created_at) THEN RAISE EXCEPTION 'JOURNEY_IDENTITY_IMMUTABLE';END IF;
 IF NEW.basis IS DISTINCT FROM OLD.basis AND (session_user<>'cadence_app' OR OLD.actor_id<>current_setting('app.user_id',true)) THEN RAISE EXCEPTION 'JOURNEY_BASIS_FORBIDDEN';END IF;
 IF OLD.cadence_id IS NOT NULL AND ROW(NEW.cadence_id,NEW.proposal_job_id) IS DISTINCT FROM ROW(OLD.cadence_id,OLD.proposal_job_id) THEN RAISE EXCEPTION 'JOURNEY_DRAFT_EXISTS';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_journey_identity() FROM PUBLIC;
CREATE TRIGGER journey_identity BEFORE UPDATE ON app.prospecting_journey FOR EACH ROW EXECUTE FUNCTION app.guard_journey_identity();

CREATE FUNCTION app.guard_journey_job_marker() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app.prospecting_journey;
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.checkpoint->'journey' IS DISTINCT FROM OLD.checkpoint->'journey' THEN RAISE EXCEPTION 'JOURNEY_MARKER_IMMUTABLE';END IF;
  IF OLD.checkpoint ? 'journey' AND ROW(NEW.workspace_id,NEW.id,NEW.actor_id,NEW.input,NEW.list_id) IS DISTINCT FROM ROW(OLD.workspace_id,OLD.id,OLD.actor_id,OLD.input,OLD.list_id) THEN RAISE EXCEPTION 'JOURNEY_MARKER_IMMUTABLE';END IF;
 ELSIF NEW.checkpoint ? 'journey' THEN
  SELECT * INTO q FROM app.prospecting_journey WHERE workspace_id=NEW.workspace_id AND id=NEW.checkpoint->'journey'->>'id';
  IF NOT FOUND OR q.actor_id<>NEW.actor_id OR NEW.actor_id<>current_setting('app.user_id',true) OR COALESCE(app.current_role(),'') NOT IN('owner','admin','operator') OR q.state<>'running' OR q.basis->'databaseAuthority' IS DISTINCT FROM app.journey_database_authority() OR NEW.checkpoint->'journey'->'databaseAuthority' IS DISTINCT FROM q.basis->'databaseAuthority' THEN RAISE EXCEPTION 'JOURNEY_CHANGED';END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_journey_job_marker() FROM PUBLIC;
CREATE TRIGGER journey_job_marker BEFORE INSERT OR UPDATE ON app.prospecting_job FOR EACH ROW EXECUTE FUNCTION app.guard_journey_job_marker();

CREATE FUNCTION app.journey_publication_allowed(p_ws text,p_job text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT NOT(j.checkpoint ? 'journey') OR (
 j.state IN('running','waiting_provider') AND j.actor_id=current_setting('app.user_id',true) AND app.current_role() IN('owner','admin','operator')
 AND j.lease_until>clock_timestamp() AND j.lease_token=COALESCE(nullif(current_setting('app.publication_token',true),''),nullif(current_setting('app.research_token',true),''),nullif(current_setting('app.billing_job_token',true),''))
 AND j.fence::text=COALESCE(nullif(current_setting('app.publication_fence',true),''),nullif(current_setting('app.research_fence',true),''),nullif(current_setting('app.billing_job_fence',true),'')) AND EXISTS(
 SELECT 1 FROM app.prospecting_journey q WHERE q.workspace_id=j.workspace_id AND q.id=j.checkpoint->'journey'->>'id' AND q.state='running' AND q.actor_id=j.actor_id
 AND q.basis->'databaseAuthority'=j.checkpoint->'journey'->'databaseAuthority' AND q.basis->'databaseAuthority'=app.journey_database_authority()))
 FROM app.prospecting_job j WHERE j.workspace_id=p_ws AND j.id=p_job AND p_ws=current_setting('app.workspace_id',true)),false)
$$;
REVOKE ALL ON FUNCTION app.journey_publication_allowed(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.journey_publication_allowed(text,text) TO cadence_worker;
CREATE FUNCTION app.guard_journey_publication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job text;
BEGIN
 IF session_user<>'cadence_worker' THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='research_case' AND TG_OP='INSERT' AND to_jsonb(NEW)->>'state'='pending' THEN RETURN NEW;END IF;
 job:=CASE WHEN TG_TABLE_NAME='lead' THEN COALESCE(nullif(current_setting('app.billing_job_id',true),''),nullif(current_setting('app.publication_job',true),'')) ELSE to_jsonb(NEW)->>'job_id' END;
 IF job IS NULL AND to_jsonb(NEW) ? 'case_id' THEN SELECT job_id INTO job FROM app.research_case WHERE workspace_id=NEW.workspace_id AND id=to_jsonb(NEW)->>'case_id';END IF;
 IF job IS NOT NULL AND NOT app.journey_publication_allowed(NEW.workspace_id,job) THEN RAISE EXCEPTION 'JOURNEY_CHANGED';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_journey_publication() FROM PUBLIC;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['lead','prospecting_item','lead_evidence','research_case','research_source','research_fact','research_company_identity','research_person','research_person_company','research_person_contact'] LOOP
  EXECUTE format('CREATE TRIGGER journey_publication BEFORE INSERT OR UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_journey_publication()',t);
 END LOOP;
END $$;

-- Preserve every proposal attempt; replacement never deletes evidence/history.
CREATE TABLE app.journey_proposal_attempt(
 workspace_id text NOT NULL,journey_id text NOT NULL,job_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,job_id),FOREIGN KEY(workspace_id,journey_id) REFERENCES app.prospecting_journey(workspace_id,id),FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id)
);
ALTER TABLE app.journey_proposal_attempt ENABLE ROW LEVEL SECURITY;ALTER TABLE app.journey_proposal_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY proposal_attempt_read ON app.journey_proposal_attempt FOR SELECT TO cadence_app,cadence_worker USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
CREATE POLICY proposal_attempt_insert ON app.journey_proposal_attempt FOR INSERT TO cadence_app WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin','operator'));
GRANT SELECT,INSERT ON app.journey_proposal_attempt TO cadence_app;GRANT SELECT ON app.journey_proposal_attempt TO cadence_worker;
INSERT INTO app.journey_proposal_attempt(workspace_id,journey_id,job_id) SELECT workspace_id,id,proposal_job_id FROM app.prospecting_journey WHERE proposal_job_id IS NOT NULL;
