-- A pilot request keeps only the current actor's session locked during each
-- short transaction. No authentication table access is granted to the app role.
CREATE FUNCTION app.lock_channel_pilot_session(p_session text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('workspaceId',s."activeOrganizationId") FROM auth.session s
 WHERE s.id=p_session AND s."userId"=current_setting('app.user_id',true)
  AND s."expiresAt">clock_timestamp() AND app.current_role() IS NOT NULL
 FOR SHARE OF s
$$;
REVOKE ALL ON FUNCTION app.lock_channel_pilot_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lock_channel_pilot_session(text) TO cadence_app;
