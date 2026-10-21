CREATE TABLE app.ai_policy(
 workspace_id text PRIMARY KEY REFERENCES auth.organization(id),revision bigint NOT NULL CHECK(revision>=1),
 mode text NOT NULL CHECK(mode IN('auto','conventional-only','hybrid-required')),
 conventional_provider text CHECK(conventional_provider IN('codex-local','openai','gemini')),jev_enabled boolean NOT NULL
);
ALTER TABLE app.ai_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON app.ai_policy FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
CREATE POLICY scoped_insert ON app.ai_policy FOR INSERT WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
CREATE POLICY scoped_update ON app.ai_policy FOR UPDATE USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin')) WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
GRANT SELECT,INSERT,UPDATE ON app.ai_policy TO cadence_app;
GRANT SELECT ON app.ai_policy TO cadence_worker;
CREATE TABLE app.ai_connection_check(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id text NOT NULL,job_id text NOT NULL,operation_id text NOT NULL,
 provider text NOT NULL CHECK(provider IN('codex-local','openai','gemini')),model text NOT NULL,config_fingerprint text NOT NULL,contract_version text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('success','failed','uncertain')),code text,checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id),UNIQUE(workspace_id,operation_id)
);
CREATE INDEX ai_connection_latest ON app.ai_connection_check(workspace_id,provider,model,config_fingerprint,checked_at DESC,id DESC);
ALTER TABLE app.ai_connection_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_connection_check FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON app.ai_connection_check FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
CREATE POLICY leased_insert ON app.ai_connection_check FOR INSERT WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL AND EXISTS(SELECT 1 FROM app.prospecting_job j WHERE j.workspace_id=ai_connection_check.workspace_id AND j.id=ai_connection_check.job_id AND j.actor_id=current_setting('app.user_id',true) AND j.lease_until>clock_timestamp()));
GRANT SELECT ON app.ai_connection_check TO cadence_app,cadence_worker;
GRANT INSERT ON app.ai_connection_check TO cadence_worker;
GRANT USAGE,SELECT ON SEQUENCE app.ai_connection_check_id_seq TO cadence_worker;

CREATE OR REPLACE FUNCTION app.reserve_prospecting_usage(p_job text,p_operation text,p_units jsonb,p_workspace_caps jsonb,p_global_caps jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true); k text; amount numeric; used_ws numeric; used_global numeric; old_units jsonb;
BEGIN
 IF app.current_role() IS NULL OR NOT EXISTS(SELECT 1 FROM app.prospecting_job WHERE workspace_id=ws AND id=p_job AND actor_id=current_setting('app.user_id',true)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('cadence-prospecting-global-usage'));
 SELECT units INTO old_units FROM app.usage_ledger WHERE workspace_id=ws AND operation_id=p_operation AND event='reserve';
 IF FOUND THEN IF old_units<>p_units THEN RAISE EXCEPTION 'USAGE_CONFLICT'; END IF; RETURN; END IF;
 FOR k,amount IN SELECT key,value::numeric FROM jsonb_each_text(p_units) LOOP
  IF k NOT IN('candidates','apifyRuns','apolloPages','jevCalls','codexCalls','openaiCalls','geminiCalls') OR amount<0 OR amount<>trunc(amount) OR amount>1000000000 THEN RAISE EXCEPTION 'INVALID_USAGE'; END IF;
  SELECT COALESCE(sum((units->>k)::numeric*CASE WHEN event='release' THEN -1 WHEN event='consume' AND created_at<date_trunc('day',now(),'UTC') THEN 0 ELSE 1 END) FILTER(WHERE workspace_id=ws),0),
         COALESCE(sum((units->>k)::numeric*CASE WHEN event='release' THEN -1 WHEN event='consume' AND created_at<date_trunc('day',now(),'UTC') THEN 0 ELSE 1 END),0)
    INTO used_ws,used_global FROM app.usage_ledger;
  IF used_ws+amount>COALESCE((p_workspace_caps->>k)::numeric,0) OR used_global+amount>COALESCE((p_global_caps->>k)::numeric,0) THEN RAISE EXCEPTION 'USAGE_LIMIT'; END IF;
 END LOOP;
 INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units) VALUES(ws,p_job,p_operation,'reserve',p_units);
END $$;
REVOKE ALL ON FUNCTION app.reserve_prospecting_usage(text,text,jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reserve_prospecting_usage(text,text,jsonb,jsonb,jsonb) TO cadence_app;
