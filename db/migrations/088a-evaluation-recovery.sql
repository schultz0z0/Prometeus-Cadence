-- Explicit administrative abandonment never attests non-execution or success.
ALTER TABLE app.ai_evaluation_run DROP CONSTRAINT ai_evaluation_run_state_check;
ALTER TABLE app.ai_evaluation_run ADD CONSTRAINT ai_evaluation_run_state_check CHECK(state IN('running','completed','blocked','uncertain','closed'));
ALTER TABLE app.ai_evaluation_run ADD COLUMN revision bigint NOT NULL DEFAULT 0,
 ADD COLUMN closed_by text,ADD COLUMN closed_session text,ADD COLUMN closed_at timestamptz,
 ADD COLUMN closure_request_id text,ADD COLUMN closure_reason text;

-- A late receipt can outlive a lease, revocation or administrative closure.
-- Its scoped opaque token grants only immutable technical metadata, no dispatch.
CREATE OR REPLACE FUNCTION app.record_evaluation_receipt(p_run text,p_token text,p_case text,p_variant text,p_receipt text,p_hash text,p_cost numeric,p_duration numeric) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.ai_evaluation_run;prior app.ai_evaluation_case;
BEGIN
 SELECT * INTO r FROM app.ai_evaluation_run WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_run AND actor_id=current_setting('app.user_id',true) AND lease_token=p_token AND state IN('running','uncertain','closed') FOR UPDATE;
 IF NOT FOUND OR session_user<>'cadence_app' OR (r.input->'caseIds' ? p_case) IS DISTINCT FROM true OR p_variant IS NULL OR p_variant NOT IN('traditional','hybrid') OR p_receipt IS NULL OR length(p_receipt) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'EVALUATION_FENCE';END IF;
 SELECT * INTO prior FROM app.ai_evaluation_case WHERE workspace_id=r.workspace_id AND run_id=r.id AND case_id=p_case AND variant=p_variant;
 IF FOUND THEN IF prior.receipt_hash IS DISTINCT FROM p_hash OR prior.receipt_id IS DISTINCT FROM p_receipt OR prior.cost_usd IS DISTINCT FROM p_cost OR prior.duration_ms IS DISTINCT FROM p_duration THEN RAISE EXCEPTION 'EVALUATION_RECEIPT_CONFLICT';END IF;RETURN false;END IF;
 INSERT INTO app.ai_evaluation_case(workspace_id,run_id,case_id,variant,receipt_id,receipt_hash,cost_usd,duration_ms) VALUES(r.workspace_id,r.id,p_case,p_variant,p_receipt,p_hash,p_cost,p_duration);
 UPDATE app.ai_evaluation_run SET revision=revision+1 WHERE workspace_id=r.workspace_id AND id=r.id;
 RETURN true;
END $$;

CREATE FUNCTION app.close_evaluation(p_run text,p_revision bigint,p_state text,p_session text,p_request text,p_reason text,p_database jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.ai_evaluation_run;known numeric;unknown bigint;
BEGIN
 SELECT * INTO r FROM app.ai_evaluation_run WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_run FOR UPDATE;
 IF NOT FOUND OR session_user<>'cadence_app' OR app.platform_ai_authority(r.workspace_id) IS DISTINCT FROM true OR (app.lock_channel_pilot_session(p_session)->>'workspaceId') IS DISTINCT FROM r.workspace_id THEN RAISE EXCEPTION 'EVALUATION_FENCE';END IF;
 IF p_request IS NULL OR p_request !~ '^[a-f0-9-]{36}$' OR p_reason IS DISTINCT FROM 'acknowledge-unresolved' OR p_database IS DISTINCT FROM app.journey_database_authority() THEN RAISE EXCEPTION 'EVALUATION_CLOSURE_INVALID';END IF;
 IF r.state='closed' AND r.closure_request_id=p_request AND r.closed_by=current_setting('app.user_id',true) THEN RETURN;END IF;
 IF r.state NOT IN('running','uncertain') OR r.state IS DISTINCT FROM p_state OR r.revision IS DISTINCT FROM p_revision OR r.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'EVALUATION_CLOSURE_CHANGED';END IF;
 SELECT coalesce(sum(cost_usd),0),count(*) FILTER(WHERE cost_usd IS NULL) INTO known,unknown FROM app.ai_evaluation_case WHERE workspace_id=r.workspace_id AND run_id=r.id;
 UPDATE app.ai_evaluation_run SET state='closed',revision=revision+1,closed_by=current_setting('app.user_id',true),closed_session=p_session,closed_at=clock_timestamp(),closure_request_id=p_request,closure_reason=p_reason,
 report=jsonb_build_object('runId',r.id,'fingerprint',r.fingerprint,'mode',r.input->>'mode','empirical',false,'accepted',false,'complete',false,'cases',jsonb_array_length(r.input->'caseIds'),'predictions',(SELECT count(*) FROM app.ai_evaluation_case WHERE workspace_id=r.workspace_id AND run_id=r.id),'unsupportedFacts',0,'crossTenantLeaks',0,'attributionPrecision',null,'coverage',null,'abstentionRate',null,'knownCostUsd',known,'costUsd',null,'unknownCosts',unknown+1,'failures',jsonb_build_array('ADMIN_CLOSED_UNRESOLVED'))
 WHERE workspace_id=r.workspace_id AND id=r.id;
END $$;
REVOKE ALL ON FUNCTION app.close_evaluation(text,bigint,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.close_evaluation(text,bigint,text,text,text,text,jsonb) TO cadence_app;
