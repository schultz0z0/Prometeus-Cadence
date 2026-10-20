CREATE TABLE app.workspace_meta(workspace_id text PRIMARY KEY REFERENCES auth.organization(id),revision bigint NOT NULL DEFAULT 0);
CREATE TABLE app.list(workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,name text NOT NULL,PRIMARY KEY(workspace_id,id));
CREATE TABLE app.lead(workspace_id text NOT NULL,id text NOT NULL,list_id text NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,list_id) REFERENCES app.list(workspace_id,id),CHECK(payload->>'id'=id AND payload->>'listId'=list_id));
CREATE INDEX lead_workspace_list ON app.lead(workspace_id,list_id);
CREATE TABLE app.automation(LIKE app.lead INCLUDING ALL);
ALTER TABLE app.automation ADD FOREIGN KEY(workspace_id,list_id) REFERENCES app.list(workspace_id,id);
CREATE TABLE app.cadence(LIKE app.lead INCLUDING ALL);
ALTER TABLE app.cadence ADD FOREIGN KEY(workspace_id,list_id) REFERENCES app.list(workspace_id,id);
CREATE TABLE app.template(workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(workspace_id,id),CHECK(payload->>'id'=id));
CREATE TABLE app.job(LIKE app.template INCLUDING ALL);
CREATE TABLE app.context_version(workspace_id text NOT NULL REFERENCES auth.organization(id),version integer NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(workspace_id,version));
CREATE TABLE app.workspace_preferences(workspace_id text PRIMARY KEY REFERENCES auth.organization(id),payload jsonb NOT NULL);
CREATE TABLE app.user_preferences(workspace_id text NOT NULL REFERENCES auth.organization(id),user_id text NOT NULL REFERENCES auth."user"(id),payload jsonb NOT NULL,PRIMARY KEY(workspace_id,user_id));
CREATE TABLE app.command_result(workspace_id text NOT NULL REFERENCES auth.organization(id),request_id text NOT NULL,user_id text NOT NULL,body_hash text NOT NULL,result jsonb,PRIMARY KEY(workspace_id,request_id));
CREATE TABLE app.audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id text NOT NULL REFERENCES auth.organization(id),user_id text NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_workspace_time ON app.audit(workspace_id,created_at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workspace_meta','list','lead','automation','cadence','template','job','context_version','workspace_preferences','command_result','audit','user_preferences'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY workspace_isolation ON app.%I USING (workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL) WITH CHECK (workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
 END LOOP;
END $$;
CREATE POLICY own_preferences ON app.user_preferences AS RESTRICTIVE USING(user_id=current_setting('app.user_id',true)) WITH CHECK(user_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA app TO cadence_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app TO cadence_app;
