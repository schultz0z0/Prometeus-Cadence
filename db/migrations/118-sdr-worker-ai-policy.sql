-- The SDR worker resolves the AI route itself and has no workspace member role; it read an empty policy and blocked every turn as AI_UNAVAILABLE.
CREATE OR REPLACE FUNCTION app.platform_ai_policy(p_expected text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('revision',COALESCE(a.revision,0),'mode',COALESCE(a.mode,'auto'),
 'conventionalProvider',a.conventional_provider,'jevEnabled',COALESCE(a.jev_enabled,true))
 FROM app.platform_ai_control p LEFT JOIN app.ai_policy a ON a.workspace_id=p.workspace_id
 WHERE p.workspace_id=p_expected AND (app.current_role() IS NOT NULL OR session_user='cadence_worker')
$$;
