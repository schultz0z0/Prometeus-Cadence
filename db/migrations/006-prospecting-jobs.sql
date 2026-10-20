CREATE TABLE app.prospecting_job (
 workspace_id text NOT NULL REFERENCES auth.organization(id), id text NOT NULL,
 actor_id text NOT NULL REFERENCES auth."user"(id), list_id text NOT NULL,
 request_id text NOT NULL, body_hash text NOT NULL, kind text NOT NULL CHECK(kind IN('generation','qualification')),
 source text NOT NULL, state text NOT NULL CHECK(state IN('queued','running','waiting_provider','needs_reconciliation','cancelling','cancelled','completed','partial','failed')),
 input jsonb NOT NULL, profile_version text NOT NULL,
 counts jsonb NOT NULL DEFAULT '{"found":0,"inserted":0,"duplicates":0,"rejected":0,"pending":0}',
 checkpoint jsonb NOT NULL DEFAULT '{}', provider_run jsonb, error_code text, error_message text,
 lease_owner text, lease_token text, lease_until timestamptz, fence bigint NOT NULL DEFAULT 0,
 revision bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,request_id),
 FOREIGN KEY(workspace_id,list_id) REFERENCES app.list(workspace_id,id)
);
CREATE INDEX prospecting_job_queue ON app.prospecting_job(state,created_at,id);
CREATE INDEX prospecting_job_history ON app.prospecting_job(workspace_id,created_at DESC,id DESC);
CREATE TABLE app.prospecting_item (
 workspace_id text NOT NULL,job_id text NOT NULL,id text NOT NULL,lead_id text,source_ref text,
 name text NOT NULL,status text NOT NULL,payload jsonb NOT NULL DEFAULT '{}',applied boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,job_id,id), UNIQUE(workspace_id,job_id,source_ref),
 FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id)
);
CREATE INDEX prospecting_items_page ON app.prospecting_item(workspace_id,job_id,id);
CREATE TABLE app.prospecting_attempt (
 workspace_id text NOT NULL,job_id text NOT NULL,id text NOT NULL,provider text NOT NULL,step text NOT NULL,
 state text NOT NULL CHECK(state IN('prepared','started','uncertain','completed','failed','cancelled')),
 remote_id text,payload jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id)
);
CREATE TABLE app.usage_ledger (
 workspace_id text NOT NULL,job_id text NOT NULL,operation_id text NOT NULL,
 event text NOT NULL CHECK(event IN('reserve','consume','release')),
 units jsonb NOT NULL,cost_usd numeric CHECK(cost_usd>=0),cost_kind text NOT NULL DEFAULT 'unknown' CHECK(cost_kind IN('reported','estimated','unknown')),
 provider text,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,operation_id,event),FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id)
);
CREATE INDEX prospecting_usage_day ON app.usage_ledger(created_at,workspace_id);
CREATE TABLE app.prospecting_policy(workspace_id text PRIMARY KEY REFERENCES auth.organization(id),limits jsonb NOT NULL,version integer NOT NULL DEFAULT 1);
CREATE TABLE app.provider_slot(resource_id text NOT NULL,slot integer NOT NULL,workspace_id text,job_id text,lease_token text,lease_until timestamptz,PRIMARY KEY(resource_id,slot));
ALTER TABLE app.provider_slot ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.provider_slot FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.provider_slot FROM cadence_app,PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['prospecting_job','prospecting_item','prospecting_attempt','usage_ledger','prospecting_policy'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY workspace_isolation ON app.%I USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL) WITH CHECK(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
 END LOOP;
END $$;
REVOKE INSERT,UPDATE,DELETE ON app.prospecting_policy FROM cadence_app;
CREATE FUNCTION app.reserve_prospecting_usage(p_job text,p_operation text,p_units jsonb,p_workspace_caps jsonb,p_global_caps jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true); k text; amount numeric; used_ws numeric; used_global numeric; old_units jsonb;
BEGIN
 IF app.current_role() IS NULL OR NOT EXISTS(SELECT 1 FROM app.prospecting_job WHERE workspace_id=ws AND id=p_job AND actor_id=current_setting('app.user_id',true)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('cadence-prospecting-global-usage'));
 SELECT units INTO old_units FROM app.usage_ledger WHERE workspace_id=ws AND operation_id=p_operation AND event='reserve';
 IF FOUND THEN IF old_units<>p_units THEN RAISE EXCEPTION 'USAGE_CONFLICT'; END IF; RETURN; END IF;
 FOR k,amount IN SELECT key,value::numeric FROM jsonb_each_text(p_units) LOOP
  IF k NOT IN('candidates','apifyRuns','apolloPages','jevCalls','codexCalls') OR amount<0 OR amount<>trunc(amount) OR amount>1000000000 THEN RAISE EXCEPTION 'INVALID_USAGE'; END IF;
  -- Carry outstanding reservations across midnight; completed prior-day usage
  -- does not reduce today's budget and old releases cannot make it negative.
  SELECT COALESCE(sum((units->>k)::numeric*CASE WHEN event='release' THEN -1 WHEN event='consume' AND created_at<date_trunc('day',now(),'UTC') THEN 0 ELSE 1 END) FILTER(WHERE workspace_id=ws),0),
         COALESCE(sum((units->>k)::numeric*CASE WHEN event='release' THEN -1 WHEN event='consume' AND created_at<date_trunc('day',now(),'UTC') THEN 0 ELSE 1 END),0)
    INTO used_ws,used_global FROM app.usage_ledger;
  IF used_ws+amount>COALESCE((p_workspace_caps->>k)::numeric,0) OR used_global+amount>COALESCE((p_global_caps->>k)::numeric,0) THEN RAISE EXCEPTION 'USAGE_LIMIT'; END IF;
 END LOOP;
 INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units) VALUES(ws,p_job,p_operation,'reserve',p_units);
END $$;
REVOKE ALL ON FUNCTION app.reserve_prospecting_usage(text,text,jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reserve_prospecting_usage(text,text,jsonb,jsonb,jsonb) TO cadence_app;
