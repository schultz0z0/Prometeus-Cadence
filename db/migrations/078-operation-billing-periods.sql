-- Renewals change the financial period without necessarily changing state/revision.
CREATE OR REPLACE FUNCTION app.record_operation_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row_data jsonb:=to_jsonb(NEW);previous jsonb;ws text;seq bigint;observed jsonb;prior_observed jsonb;state_value text;
BEGIN
 observed:=jsonb_build_array(row_data->TG_ARGV[1],row_data->'revision',row_data->'ready',row_data->'sync_state',row_data->'sync_gap');
 IF TG_ARGV[0]='billing' THEN observed:=observed||jsonb_build_array(row_data->'plan',row_data->'period_start',row_data->'period_end',row_data->'subscription_id',row_data->'next_plan',row_data->'cancel_at_period_end');END IF;
 IF TG_OP='UPDATE' THEN
  previous:=to_jsonb(OLD);
  prior_observed:=jsonb_build_array(previous->TG_ARGV[1],previous->'revision',previous->'ready',previous->'sync_state',previous->'sync_gap');
  IF TG_ARGV[0]='billing' THEN prior_observed:=prior_observed||jsonb_build_array(previous->'plan',previous->'period_start',previous->'period_end',previous->'subscription_id',previous->'next_plan',previous->'cancel_at_period_end');END IF;
  IF observed=prior_observed THEN RETURN NEW;END IF;
 END IF;
 ws:=row_data->>'workspace_id';
 state_value:=COALESCE(row_data->>TG_ARGV[1],CASE WHEN (row_data->>'ready')::boolean THEN 'ready' ELSE 'pending' END);
 INSERT INTO app.operation_head(workspace_id,sequence) VALUES(ws,1)
 ON CONFLICT(workspace_id) DO UPDATE SET sequence=app.operation_head.sequence+1 RETURNING sequence INTO seq;
 INSERT INTO app.operation_event(workspace_id,sequence,kind,entity_id,state,revision)
 VALUES(ws,seq,TG_ARGV[0],row_data->>TG_ARGV[2],state_value,COALESCE((row_data->>'revision')::bigint,0));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.record_operation_transition() FROM PUBLIC,cadence_app,cadence_worker,cadence_ingress,cadence_dispatcher,cadence_billing;
