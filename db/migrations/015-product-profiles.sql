CREATE TABLE app.product_profile (
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),draft jsonb NOT NULL,approved jsonb,
 archived boolean NOT NULL DEFAULT false,origin jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE app.product_profile_version (
 workspace_id text NOT NULL,product_id text NOT NULL,version integer NOT NULL CHECK(version>0),
 action text NOT NULL CHECK(action IN('save-draft','approve','archive')),payload jsonb NOT NULL,
 origin jsonb NOT NULL DEFAULT '{}',created_by text NOT NULL REFERENCES auth."user"(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,product_id,version),FOREIGN KEY(workspace_id,product_id) REFERENCES app.product_profile(workspace_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['product_profile','product_profile_version'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker',t);
  EXECUTE format('CREATE POLICY workspace_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
  EXECUTE format('CREATE POLICY admin_insert ON app.%I FOR INSERT TO cadence_app WITH CHECK(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IN(''owner'',''admin''))',t);
  EXECUTE format('GRANT SELECT ON app.%I TO cadence_app,cadence_worker',t);
  EXECUTE format('GRANT INSERT ON app.%I TO cadence_app',t);
 END LOOP;
END $$;
CREATE POLICY admin_update ON app.product_profile FOR UPDATE TO cadence_app
 USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'))
 WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
GRANT UPDATE ON app.product_profile TO cadence_app;
