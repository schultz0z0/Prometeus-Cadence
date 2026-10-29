-- Administrative evaluation journal. No client-tenant role can self-attest.
CREATE TABLE app.ai_evaluation_run(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,actor_id text NOT NULL,session_id text NOT NULL,
 request_id text NOT NULL,body_hash text NOT NULL,fingerprint text NOT NULL,input jsonb NOT NULL,versions jsonb NOT NULL,database_basis jsonb NOT NULL,
 lease_token text NOT NULL,lease_until timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',
 state text NOT NULL DEFAULT 'running' CHECK(state IN('running','completed','blocked','uncertain')),report jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,request_id)
);
CREATE UNIQUE INDEX one_live_evaluation ON app.ai_evaluation_run(workspace_id) WHERE input->>'mode'='live-owned' AND state IN('running','uncertain');
CREATE TABLE app.ai_evaluation_case(
 workspace_id text NOT NULL,run_id text NOT NULL,case_id text NOT NULL,variant text NOT NULL CHECK(variant IN('traditional','hybrid')),
 receipt_id text NOT NULL,receipt_hash text NOT NULL CHECK(receipt_hash ~ '^[a-f0-9]{64}$'),cost_usd numeric CHECK(cost_usd>=0),duration_ms numeric NOT NULL CHECK(duration_ms>=0),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,run_id,case_id,variant),
 FOREIGN KEY(workspace_id,run_id) REFERENCES app.ai_evaluation_run(workspace_id,id)
);
ALTER TABLE app.ai_evaluation_run ENABLE ROW LEVEL SECURITY;ALTER TABLE app.ai_evaluation_run FORCE ROW LEVEL SECURITY;
ALTER TABLE app.ai_evaluation_case ENABLE ROW LEVEL SECURITY;ALTER TABLE app.ai_evaluation_case FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_evaluation_run,app.ai_evaluation_case FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher;
CREATE POLICY evaluation_read ON app.ai_evaluation_run FOR SELECT TO cadence_app USING(app.platform_ai_authority(workspace_id));
CREATE POLICY evaluation_case_read ON app.ai_evaluation_case FOR SELECT TO cadence_app USING(app.platform_ai_authority(workspace_id));
CREATE POLICY evaluation_start ON app.ai_evaluation_run FOR INSERT TO cadence_app WITH CHECK(app.platform_ai_authority(workspace_id) AND actor_id=current_setting('app.user_id',true) AND (app.lock_channel_pilot_session(session_id)->>'workspaceId')=workspace_id AND database_basis=app.journey_database_authority());
GRANT SELECT ON app.ai_evaluation_run,app.ai_evaluation_case TO cadence_app;
GRANT INSERT(workspace_id,id,actor_id,session_id,request_id,body_hash,fingerprint,input,versions,database_basis,lease_token) ON app.ai_evaluation_run TO cadence_app;

-- Receipt is technical metadata only. A formerly authorized in-flight admin can
-- record it after revocation, but cannot publish an evaluation report.
CREATE FUNCTION app.record_evaluation_receipt(p_run text,p_token text,p_case text,p_variant text,p_receipt text,p_hash text,p_cost numeric,p_duration numeric) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.ai_evaluation_run;prior app.ai_evaluation_case;
BEGIN
 SELECT * INTO r FROM app.ai_evaluation_run WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_run AND actor_id=current_setting('app.user_id',true) AND lease_token=p_token AND lease_until>clock_timestamp() AND state='running' FOR UPDATE;
 IF NOT FOUND OR session_user<>'cadence_app' OR NOT(r.input->'caseIds' ? p_case) OR p_variant NOT IN('traditional','hybrid') OR length(p_receipt) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'EVALUATION_FENCE';END IF;
 SELECT * INTO prior FROM app.ai_evaluation_case WHERE workspace_id=r.workspace_id AND run_id=r.id AND case_id=p_case AND variant=p_variant;
 IF FOUND THEN IF prior.receipt_hash<>p_hash OR prior.receipt_id<>p_receipt OR prior.cost_usd IS DISTINCT FROM p_cost OR prior.duration_ms<>p_duration THEN RAISE EXCEPTION 'EVALUATION_RECEIPT_CONFLICT';END IF;RETURN false;END IF;
 INSERT INTO app.ai_evaluation_case(workspace_id,run_id,case_id,variant,receipt_id,receipt_hash,cost_usd,duration_ms) VALUES(r.workspace_id,r.id,p_case,p_variant,p_receipt,p_hash,p_cost,p_duration);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.record_evaluation_receipt(text,text,text,text,text,text,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_evaluation_receipt(text,text,text,text,text,text,numeric,numeric) TO cadence_app;
CREATE FUNCTION app.finish_evaluation(p_run text,p_token text,p_fingerprint text,p_report jsonb,p_state text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.ai_evaluation_run;
BEGIN
 SELECT * INTO r FROM app.ai_evaluation_run WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_run FOR UPDATE;
 IF NOT FOUND OR session_user<>'cadence_app' OR NOT app.platform_ai_authority(r.workspace_id) OR r.actor_id<>current_setting('app.user_id',true) OR r.lease_token<>p_token OR r.lease_until<=clock_timestamp() OR r.state<>'running' OR (app.lock_channel_pilot_session(r.session_id)->>'workspaceId') IS DISTINCT FROM r.workspace_id THEN RAISE EXCEPTION 'EVALUATION_FENCE';END IF;
 IF r.database_basis IS DISTINCT FROM app.journey_database_authority() OR r.fingerprint<>p_fingerprint THEN RAISE EXCEPTION 'EVALUATION_CHANGED';END IF;
 IF p_state NOT IN('completed','blocked','uncertain') OR jsonb_typeof(p_report)<>'object' OR p_report->>'runId'<>r.id OR p_report->>'mode'<>r.input->>'mode' OR p_report->>'fingerprint'<>r.fingerprint OR (p_report->>'empirical')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'EVALUATION_REPORT_INVALID';END IF;
 IF p_state<>'completed' AND (p_report->>'accepted')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'EVALUATION_REPORT_INVALID';END IF;
 IF p_state='completed' AND (SELECT count(*) FROM app.ai_evaluation_case WHERE workspace_id=r.workspace_id AND run_id=r.id)<>2*jsonb_array_length(r.input->'caseIds') THEN RAISE EXCEPTION 'EVALUATION_INCOMPLETE';END IF;
 UPDATE app.ai_evaluation_run SET state=p_state,report=p_report,lease_until=clock_timestamp() WHERE workspace_id=r.workspace_id AND id=r.id;
END $$;
REVOKE ALL ON FUNCTION app.finish_evaluation(text,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finish_evaluation(text,text,text,jsonb,text) TO cadence_app;
