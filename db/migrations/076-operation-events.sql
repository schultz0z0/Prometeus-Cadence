-- Only operational metadata. Source tables remain authoritative for facts/content.
CREATE TABLE app.operation_head(
 workspace_id text PRIMARY KEY REFERENCES auth.organization(id),sequence bigint NOT NULL CHECK(sequence>=1)
);
CREATE TABLE app.operation_event(
 workspace_id text NOT NULL REFERENCES auth.organization(id),sequence bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN('job','automation','channel','sender','mailbox','message','outbox','billing')),
 entity_id text NOT NULL,state text NOT NULL,revision bigint NOT NULL DEFAULT 0,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,sequence)
);
ALTER TABLE app.operation_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.operation_head FORCE ROW LEVEL SECURITY;
ALTER TABLE app.operation_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.operation_event FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.operation_head,app.operation_event FROM PUBLIC,cadence_app,cadence_worker,cadence_ingress,cadence_dispatcher,cadence_billing;
CREATE POLICY tenant_read ON app.operation_head FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
CREATE POLICY tenant_read ON app.operation_event FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT ON app.operation_head,app.operation_event TO cadence_app;

CREATE FUNCTION app.record_operation_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row_data jsonb:=to_jsonb(NEW);previous jsonb;ws text;seq bigint;observed jsonb;prior_observed jsonb;state_value text;
BEGIN
 -- Lease/freshness-only writes do not generate activity or expose provider data.
 observed:=jsonb_build_array(row_data->TG_ARGV[1],row_data->'revision',row_data->'ready',row_data->'sync_state',row_data->'sync_gap');
 IF TG_OP='UPDATE' THEN
  previous:=to_jsonb(OLD);
  prior_observed:=jsonb_build_array(previous->TG_ARGV[1],previous->'revision',previous->'ready',previous->'sync_state',previous->'sync_gap');
  IF observed=prior_observed THEN RETURN NEW;END IF;
 END IF;
 ws:=row_data->>'workspace_id';
 state_value:=COALESCE(row_data->>TG_ARGV[1],CASE WHEN (row_data->>'ready')::boolean THEN 'ready' ELSE 'pending' END);
 -- Deferred trigger runs at COMMIT, after business writes. Serialize publication only.
 INSERT INTO app.operation_head(workspace_id,sequence) VALUES(ws,1)
 ON CONFLICT(workspace_id) DO UPDATE SET sequence=app.operation_head.sequence+1 RETURNING sequence INTO seq;
 INSERT INTO app.operation_event(workspace_id,sequence,kind,entity_id,state,revision)
 VALUES(ws,seq,TG_ARGV[0],row_data->>TG_ARGV[2],state_value,COALESCE((row_data->>'revision')::bigint,0));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.record_operation_transition() FROM PUBLIC,cadence_app,cadence_worker,cadence_ingress,cadence_dispatcher,cadence_billing;
DO $$ DECLARE entry text[];BEGIN
 FOREACH entry SLICE 1 IN ARRAY ARRAY[
 ['prospecting_job','job','state','id'],['automation_runtime','automation','status','automation_id'],
 ['channel_connection','channel','state','id'],['channel_sender','sender','state','id'],
 ['email_mailbox','mailbox','state','id'],['channel_message','message','state','id'],
 ['message_outbox','outbox','state','message_id'],['billing_account','billing','state','workspace_id']
 ] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER operation_transition AFTER INSERT OR UPDATE ON app.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.record_operation_transition(%L,%L,%L)',entry[1],entry[2],entry[3],entry[4]);
 END LOOP;
END $$;
-- No historical transition backfill: timestamps from existing rows are not history.
