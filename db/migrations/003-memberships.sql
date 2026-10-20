ALTER TABLE auth.member ADD CONSTRAINT member_workspace_user_unique UNIQUE ("organizationId","userId");
CREATE TABLE auth.workspace_request(user_id text NOT NULL REFERENCES auth."user"(id), request_id text NOT NULL, workspace_id text NOT NULL REFERENCES auth.organization(id), PRIMARY KEY(user_id,request_id));
CREATE TABLE auth.membership_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id text NOT NULL, workspace_id text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON ALL TABLES IN SCHEMA auth TO cadence_auth;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA auth TO cadence_auth;
-- Runtime app role may check only the current context's membership, never query auth tables.
CREATE FUNCTION app.current_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT role FROM auth.member WHERE "organizationId"=current_setting('app.workspace_id',true) AND "userId"=current_setting('app.user_id',true)
$$;
CREATE FUNCTION app.lock_membership() RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT role FROM auth.member WHERE "organizationId"=current_setting('app.workspace_id',true) AND "userId"=current_setting('app.user_id',true) FOR SHARE
$$;
REVOKE ALL ON FUNCTION app.current_role(),app.lock_membership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_role(),app.lock_membership() TO cadence_app;
