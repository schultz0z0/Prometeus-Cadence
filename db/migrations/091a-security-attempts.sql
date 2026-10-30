CREATE TABLE auth.factor_rate(key text PRIMARY KEY,started_at timestamptz NOT NULL DEFAULT clock_timestamp(),attempts integer NOT NULL DEFAULT 1);
GRANT SELECT,INSERT,UPDATE,DELETE ON auth.factor_rate TO cadence_auth;
REVOKE ALL ON auth.factor_rate FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing;
CREATE FUNCTION app.second_factor_allowed(sid text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT NOT coalesce(u."twoFactorEnabled",false) OR s."twoFactorVerified" FROM auth.session s JOIN auth."user" u ON u.id=s."userId" WHERE s.id=sid AND u.id=current_setting('app.user_id',true) AND s."expiresAt">clock_timestamp()
$$;
REVOKE ALL ON FUNCTION app.second_factor_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.second_factor_allowed(text) TO cadence_app;
