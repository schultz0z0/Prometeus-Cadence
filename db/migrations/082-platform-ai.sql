-- The control workspace is designated by deployment tooling, never by signup.
CREATE TABLE app.platform_ai_control(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 workspace_id text NOT NULL REFERENCES auth.organization(id),
 admin_user_ids text[] NOT NULL CHECK(cardinality(admin_user_ids) BETWEEN 1 AND 20)
);
REVOKE ALL ON app.platform_ai_control FROM PUBLIC,cadence_app,cadence_worker,cadence_auth,cadence_ingress,cadence_dispatcher;

CREATE FUNCTION app.platform_ai_authority(p_expected text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT COALESCE(EXISTS(SELECT 1 FROM app.platform_ai_control p
 WHERE p.workspace_id=p_expected AND p.workspace_id=current_setting('app.workspace_id',true)
 AND current_setting('app.user_id',true)=ANY(p.admin_user_ids)
 AND app.current_role() IN('owner','admin')),false)
$$;
REVOKE ALL ON FUNCTION app.platform_ai_authority(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_ai_authority(text) TO cadence_app,cadence_worker;

DROP POLICY scoped_insert ON app.ai_policy;
DROP POLICY scoped_update ON app.ai_policy;
CREATE POLICY platform_insert ON app.ai_policy FOR INSERT WITH CHECK(app.platform_ai_authority(workspace_id));
CREATE POLICY platform_update ON app.ai_policy FOR UPDATE USING(app.platform_ai_authority(workspace_id)) WITH CHECK(app.platform_ai_authority(workspace_id));

CREATE FUNCTION app.platform_ai_policy(p_expected text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('revision',COALESCE(a.revision,0),'mode',COALESCE(a.mode,'auto'),
 'conventionalProvider',a.conventional_provider,'jevEnabled',COALESCE(a.jev_enabled,true))
 FROM app.platform_ai_control p LEFT JOIN app.ai_policy a ON a.workspace_id=p.workspace_id
 WHERE p.workspace_id=p_expected AND app.current_role() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION app.platform_ai_policy(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_ai_policy(text) TO cadence_app,cadence_worker;

CREATE FUNCTION app.platform_ai_check(p_expected text,p_provider text,p_model text,p_fingerprint text,p_contract text,p_fresh text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text;r app.ai_connection_check;a record;is_admin boolean;
BEGIN
 IF app.current_role() IS NULL THEN RETURN NULL;END IF;
 SELECT workspace_id INTO ws FROM app.platform_ai_control WHERE workspace_id=p_expected;
 IF ws IS NULL THEN RETURN NULL;END IF;
 is_admin:=app.platform_ai_authority(ws);
 SELECT * INTO r FROM app.ai_connection_check WHERE workspace_id=ws AND provider=p_provider AND model=p_model AND config_fingerprint=p_fingerprint AND contract_version=p_contract ORDER BY checked_at DESC,id DESC LIMIT 1;
 SELECT x.id,x.job_id,x.created_at INTO a FROM app.prospecting_attempt x
 JOIN app.prospecting_job j ON j.workspace_id=x.workspace_id AND j.id=x.job_id
 WHERE x.workspace_id=ws AND x.provider=CASE WHEN p_provider='codex-local' THEN 'codex' ELSE p_provider END
 AND (x.state IN('prepared','started','uncertain') OR (x.state='failed' AND x.payload->>'resultUnavailable'='true'))
 AND j.checkpoint->'execution'->'aiRoute'->'conventional'->>'provider'=p_provider
 AND j.checkpoint->'execution'->'aiRoute'->'conventional'->>'model'=p_model
 AND j.checkpoint->'execution'->'aiRoute'->'conventional'->>'configFingerprint'=p_fingerprint
 AND j.checkpoint->'execution'->'aiRoute'->'conventional'->>'contractVersion'=p_contract
 AND (r.checked_at IS NULL OR x.created_at>=r.checked_at)
 AND (NOT is_admin OR p_fresh IS NULL OR x.id<>p_fresh)
 ORDER BY x.created_at DESC,x.id DESC LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('outcome','uncertain','checked_at',a.created_at,'job_id',CASE WHEN is_admin THEN a.job_id ELSE 'platform' END,'operation_id',CASE WHEN is_admin THEN a.id ELSE 'platform' END,'code','CONVENTIONAL_ATTEMPT_UNRESOLVED');END IF;
 IF r.id IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('outcome',r.outcome,'checked_at',r.checked_at,'job_id',CASE WHEN is_admin THEN r.job_id ELSE 'platform' END,'operation_id',CASE WHEN is_admin THEN r.operation_id ELSE 'platform' END,'code',r.code);
END $$;
REVOKE ALL ON FUNCTION app.platform_ai_check(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_ai_check(text,text,text,text,text,text) TO cadence_app,cadence_worker;
