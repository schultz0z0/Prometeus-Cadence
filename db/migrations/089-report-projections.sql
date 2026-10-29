-- Rebuildable technical projections only. Business records remain authoritative.
CREATE TABLE app.report_source_head(workspace_id text PRIMARY KEY REFERENCES auth.organization(id),revision bigint NOT NULL DEFAULT 0);
CREATE TABLE app.report_projection_checkpoint(
 workspace_id text NOT NULL REFERENCES auth.organization(id),projection_version text NOT NULL,period text NOT NULL,
 from_at timestamptz NOT NULL,to_at timestamptz NOT NULL,timezone text NOT NULL,cadence_id text,
 source_revision bigint NOT NULL,as_of timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,projection_version,period),CHECK(to_at>from_at AND to_at-from_at<=interval '93 days')
);
CREATE TABLE app.report_daily_projection(
 workspace_id text NOT NULL,projection_version text NOT NULL,period text NOT NULL,key text NOT NULL,date date,values jsonb NOT NULL,
 PRIMARY KEY(workspace_id,projection_version,period,key),
 FOREIGN KEY(workspace_id,projection_version,period) REFERENCES app.report_projection_checkpoint(workspace_id,projection_version,period) ON DELETE CASCADE,
 CHECK(length(key)<=500 AND jsonb_typeof(values)='object' AND pg_column_size(values)<=8192)
);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['report_source_head','report_projection_checkpoint','report_daily_projection'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
 EXECUTE format('CREATE POLICY report_read ON app.%I FOR SELECT TO cadence_app USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
 EXECUTE format('GRANT SELECT ON app.%I TO cadence_app',t);
END LOOP;END $$;
CREATE INDEX report_checkpoint_recent ON app.report_projection_checkpoint(workspace_id,as_of DESC);
CREATE FUNCTION app.invalidate_report_projection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text;BEGIN
 ws:=CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
 INSERT INTO app.report_source_head(workspace_id,revision) VALUES(ws,1) ON CONFLICT(workspace_id) DO UPDATE SET revision=app.report_source_head.revision+1;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION app.invalidate_report_projection() FROM PUBLIC;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['lead','cadence','cadence_publication','cadence_enrollment','channel_message','message_outbox','email_message','email_bounce','contact_suppression','prospecting_job'] LOOP
 EXECUTE format('CREATE TRIGGER report_source_change AFTER INSERT OR UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.invalidate_report_projection()',t);
END LOOP;END $$;
