ALTER TABLE app.billing_account ADD COLUMN customer_request jsonb;
CREATE TABLE app.billing_subscription_history(workspace_id text NOT NULL REFERENCES app.billing_account(workspace_id),subscription_id text NOT NULL,replacement_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,subscription_id));
REVOKE ALL ON app.billing_subscription_history FROM PUBLIC,cadence_app,cadence_worker,cadence_billing;
ALTER TABLE app.billing_subscription_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.billing_subscription_history FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_read ON app.billing_subscription_history FOR SELECT TO cadence_billing USING(true);
GRANT SELECT ON app.billing_subscription_history TO cadence_billing;

CREATE OR REPLACE FUNCTION app.billing_claim_operation(p_id text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.billing_operation;a app.billing_account;t text:=gen_random_uuid()::text;
BEGIN
 SELECT x.* INTO o FROM app.billing_operation x JOIN app.billing_account b ON b.workspace_id=x.workspace_id WHERE(p_id IS NULL OR x.id=p_id) AND x.state IN('prepared','processing','uncertain') AND(x.lease_until IS NULL OR x.lease_until<clock_timestamp()) AND(b.busy_until IS NULL OR b.busy_until<clock_timestamp()) AND(p_id IS NOT NULL OR x.retry_at<=clock_timestamp()) ORDER BY x.created_at,x.id LIMIT 1 FOR UPDATE OF x,b SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE app.billing_account SET busy_token=t,busy_until=clock_timestamp()+interval '90 seconds',customer_started_at=CASE WHEN customer_id IS NULL THEN COALESCE(customer_started_at,clock_timestamp()) ELSE customer_started_at END,customer_request=CASE WHEN customer_id IS NULL THEN COALESCE(customer_request,contact) ELSE customer_request END WHERE workspace_id=o.workspace_id RETURNING * INTO a;
 UPDATE app.billing_operation SET state='processing',lease_token=t,lease_until=clock_timestamp()+interval '90 seconds',attempts=attempts+1,updated_at=clock_timestamp() WHERE workspace_id=o.workspace_id AND id=o.id RETURNING * INTO o;
 RETURN to_jsonb(o)||jsonb_build_object('account',to_jsonb(a));
END $$;
ALTER FUNCTION app.billing_update_operation(text,text,text,text,jsonb) RENAME TO billing_update_operation_pre_frozen_customer;
CREATE FUNCTION app.billing_update_operation(p_ws text,p_id text,p_token text,p_action text,p_data jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved boolean;a app.billing_account;o app.billing_operation;
BEGIN
 IF p_action='financial_request' THEN
  PERFORM 1 FROM app.billing_account WHERE workspace_id=p_ws AND busy_token=p_token FOR UPDATE;IF NOT FOUND THEN RETURN false;END IF;
  UPDATE app.billing_operation SET stage='financial_requested',updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() AND state='processing';RETURN FOUND;
 END IF;
 saved:=app.billing_update_operation_pre_frozen_customer(p_ws,p_id,p_token,p_action,p_data);
 IF saved AND p_action='customer' THEN
  SELECT * INTO a FROM app.billing_account WHERE workspace_id=p_ws FOR UPDATE;
  SELECT * INTO o FROM app.billing_operation WHERE workspace_id=p_ws AND id=p_id;
  IF a.customer_request IS DISTINCT FROM a.contact THEN
   INSERT INTO app.billing_operation(workspace_id,id,request_id,actor_id,body_hash,kind,expected_revision,state,proof,customer_id) VALUES(p_ws,gen_random_uuid()::text,'customer-contact:'||p_id||':'||md5(a.contact::text),o.actor_id,md5(a.contact::text),'contact',a.revision,'prepared',jsonb_build_object('contact',a.contact),a.customer_id) ON CONFLICT(workspace_id,request_id) DO NOTHING;
  END IF;
 END IF;RETURN saved;
END $$;
REVOKE ALL ON FUNCTION app.billing_update_operation_pre_frozen_customer(text,text,text,text,jsonb),app.billing_update_operation(text,text,text,text,jsonb) FROM PUBLIC,cadence_app,cadence_worker,cadence_billing;
GRANT EXECUTE ON FUNCTION app.billing_update_operation(text,text,text,text,jsonb) TO cadence_billing;

DO $$ DECLARE definition text;needle text;replacement text;BEGIN
 SELECT pg_get_functiondef('app.billing_apply_event(text,text,jsonb,text)'::regprocedure) INTO definition;
 needle:='IF a.subscription_id IS NOT NULL AND a.subscription_id<>p_data->>''subscription_id'' THEN RAISE EXCEPTION ''BILLING_SUBSCRIPTION_CHANGED'';END IF;';
 replacement:=$body$IF a.subscription_id IS NOT NULL AND a.subscription_id<>p_data->>'subscription_id' THEN
  IF EXISTS(SELECT 1 FROM app.billing_subscription_history WHERE workspace_id=ws AND subscription_id=p_data->>'subscription_id') THEN
   UPDATE app.billing_event_inbox SET state='done',error_code=NULL,lease_token=NULL,lease_until=NULL WHERE id=p_id;
   UPDATE app.billing_account SET busy_token=NULL,busy_until=NULL WHERE workspace_id=ws AND busy_token=p_token;RETURN true;
  END IF;
  IF a.state NOT IN('canceled','inactive') OR NOT COALESCE((p_data->>'paid')::boolean,false) OR NOT EXISTS(SELECT 1 FROM app.billing_operation WHERE workspace_id=ws AND id=p_data->>'approved_operation_id' AND kind='checkout' AND sku=p_data->>'plan' AND state='awaiting_payment' AND customer_id=a.customer_id AND remote_id=p_data->>'approved_session_id') THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_CHANGED';END IF;
  INSERT INTO app.billing_subscription_history(workspace_id,subscription_id,replacement_id) VALUES(ws,a.subscription_id,p_data->>'subscription_id');
  UPDATE app.billing_grant SET revoked=true WHERE workspace_id=ws AND source='plan' AND unit<>'enrichment' AND external_ref LIKE a.subscription_id||':%';
  UPDATE app.billing_account SET subscription_id=p_data->>'subscription_id' WHERE workspace_id=ws;a.subscription_id:=p_data->>'subscription_id';
 END IF;$body$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'BILLING_REPLACEMENT_UPGRADE_REQUIRED';END IF;definition:=replace(definition,needle,replacement);
 needle:='OR kind=''upgrade'');';replacement:='OR(kind=''upgrade'' AND id=p_data->>''upgrade_paid_operation_id''));';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'BILLING_UPGRADE_COMPLETION_REQUIRED';END IF;definition:=replace(definition,needle,replacement);
 needle:='IF p_data->''invoice'' IS NOT NULL THEN';
 replacement:=$body$IF p_data->>'upgrade_expired_operation_id' IS NOT NULL THEN
 UPDATE app.billing_operation SET state='failed',error_code='UPGRADE_EXPIRED',updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_data->>'upgrade_expired_operation_id' AND kind='upgrade' AND state='awaiting_payment' AND result->>'invoiceId'=p_data->>'expired_invoice_id';END IF;
 IF p_data->'invoice' IS NOT NULL THEN$body$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'BILLING_UPGRADE_EXPIRY_REQUIRED';END IF;EXECUTE replace(definition,needle,replacement);
END $$;

-- Private cleanup does not depend on the removed creator's current membership.
-- A terminal row alone is insufficient: unresolved attempts and remote runs retain their holds.
CREATE FUNCTION app.billing_release_resolved_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.billing_allocation;k text:='job:'||NEW.id;
BEGIN
 IF NEW.state NOT IN('completed','partial','failed','cancelled') THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM app.prospecting_attempt WHERE workspace_id=NEW.workspace_id AND job_id=NEW.id AND(state IN('prepared','uncertain') OR payload->'result'->>'kind'='uncertain')) THEN RETURN NEW;END IF;
 IF NOT COALESCE((NEW.checkpoint->>'remoteTerminal')::boolean,false) AND EXISTS(SELECT 1 FROM(SELECT NEW.provider_run AS r UNION ALL SELECT payload->'result'->'run' FROM app.prospecting_attempt WHERE workspace_id=NEW.workspace_id AND job_id=NEW.id AND provider='apify') runs WHERE r->>'runId' IS NOT NULL AND NOT COALESCE(NEW.checkpoint->'cleanupDone','[]') ? (r->>'runId')) THEN RETURN NEW;END IF;
 PERFORM 1 FROM app.billing_account WHERE workspace_id=NEW.workspace_id FOR UPDATE;
 FOR a IN SELECT * FROM app.billing_allocation WHERE workspace_id=NEW.workspace_id AND key=k AND held>0 FOR UPDATE LOOP
  UPDATE app.billing_grant SET held=held-a.held WHERE workspace_id=NEW.workspace_id AND id=a.grant_id;
  UPDATE app.billing_allocation SET held=0 WHERE workspace_id=NEW.workspace_id AND key=k AND unit=a.unit AND grant_id=a.grant_id;
  INSERT INTO app.billing_entry(workspace_id,operation_key,unit,event,quantity,grant_id) VALUES(NEW.workspace_id,k,a.unit,'release',a.held,a.grant_id) ON CONFLICT DO NOTHING;
 END LOOP;
 UPDATE app.billing_reservation SET closed=true WHERE workspace_id=NEW.workspace_id AND key=k;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.billing_release_resolved_job() FROM PUBLIC;
CREATE TRIGGER billing_release_resolved_job AFTER UPDATE OF state ON app.prospecting_job FOR EACH ROW EXECUTE FUNCTION app.billing_release_resolved_job();
UPDATE app.prospecting_job j SET state=j.state WHERE j.state IN('completed','partial','failed','cancelled') AND EXISTS(SELECT 1 FROM app.billing_allocation b WHERE b.workspace_id=j.workspace_id AND b.key='job:'||j.id AND b.held>0);
