ALTER TABLE app.billing_operation DROP CONSTRAINT billing_operation_state_check;
ALTER TABLE app.billing_operation ADD CHECK(state IN('prepared','processing','uncertain','awaiting_payment','completed','failed'));
DROP INDEX app.billing_subscription_operation;
CREATE UNIQUE INDEX billing_subscription_operation ON app.billing_operation(workspace_id) WHERE (kind IN('upgrade','downgrade','cancel') OR(kind='checkout' AND sku IN('essential','pro'))) AND state IN('prepared','processing','uncertain','awaiting_payment');
ALTER TABLE app.billing_operation ADD COLUMN retry_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE app.billing_account ADD COLUMN busy_token text,ADD COLUMN busy_until timestamptz,ADD COLUMN customer_started_at timestamptz;

CREATE FUNCTION app.billing_prepare_operation(p_id text,p_request text,p_hash text,p_kind text,p_sku text,p_revision bigint,p_proof jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.billing_account;o app.billing_operation;offer app.billing_catalog;
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO a FROM app.billing_account WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO o FROM app.billing_operation WHERE workspace_id=ws AND request_id=p_request;
 IF FOUND THEN IF o.actor_id<>current_setting('app.user_id') OR o.body_hash<>p_hash THEN RAISE EXCEPTION 'BILLING_REPLAY_CHANGED';END IF;RETURN to_jsonb(o);END IF;
 IF a.revision<>p_revision THEN RAISE EXCEPTION 'BILLING_CHANGED';END IF;
 IF p_kind='checkout' THEN
  SELECT * INTO offer FROM app.billing_catalog WHERE sku=p_sku AND available;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_SKU_UNAVAILABLE';END IF;
  IF offer.kind='plan' AND a.subscription_id IS NOT NULL AND a.state IN('active','past_due','attention') THEN RAISE EXCEPTION 'SUBSCRIPTION_ACTIVE';END IF;
  IF offer.kind='pack' THEN PERFORM app.billing_require_execution(ws);END IF;
 ELSE
  IF a.subscription_id IS NULL OR p_kind NOT IN('cancel','upgrade','downgrade','payment-method') THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_REQUIRED';END IF;
 END IF;
 INSERT INTO app.billing_operation(workspace_id,id,request_id,actor_id,body_hash,kind,sku,expected_revision,proof,customer_id)
 VALUES(ws,p_id,p_request,current_setting('app.user_id'),p_hash,p_kind,p_sku,p_revision,p_proof,a.customer_id) RETURNING * INTO o;
 INSERT INTO app.audit(workspace_id,user_id,action) VALUES(ws,current_setting('app.user_id'),'billing.'||p_kind);RETURN to_jsonb(o);
END $$;
REVOKE ALL ON FUNCTION app.billing_prepare_operation(text,text,text,text,text,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.billing_prepare_operation(text,text,text,text,text,bigint,jsonb) TO cadence_app;

CREATE FUNCTION app.billing_claim_operation(p_id text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.billing_operation;a app.billing_account;t text:=gen_random_uuid()::text;
BEGIN
 SELECT x.* INTO o FROM app.billing_operation x JOIN app.billing_account b ON b.workspace_id=x.workspace_id
 WHERE (p_id IS NULL OR x.id=p_id) AND x.state IN('prepared','processing','uncertain') AND(x.lease_until IS NULL OR x.lease_until<clock_timestamp()) AND(b.busy_until IS NULL OR b.busy_until<clock_timestamp()) AND(p_id IS NOT NULL OR x.retry_at<=clock_timestamp()) ORDER BY x.created_at,x.id LIMIT 1 FOR UPDATE OF x,b SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE app.billing_account SET busy_token=t,busy_until=clock_timestamp()+interval '90 seconds',customer_started_at=CASE WHEN customer_id IS NULL THEN COALESCE(customer_started_at,clock_timestamp()) ELSE customer_started_at END WHERE workspace_id=o.workspace_id RETURNING * INTO a;
 UPDATE app.billing_operation SET state='processing',lease_token=t,lease_until=clock_timestamp()+interval '90 seconds',attempts=attempts+1,updated_at=clock_timestamp() WHERE workspace_id=o.workspace_id AND id=o.id RETURNING * INTO o;
 RETURN to_jsonb(o)||jsonb_build_object('account',to_jsonb(a));
END $$;
CREATE FUNCTION app.billing_update_operation(p_ws text,p_id text,p_token text,p_action text,p_data jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.billing_operation;a app.billing_account;
BEGIN
 SELECT * INTO a FROM app.billing_account WHERE workspace_id=p_ws FOR UPDATE;
 SELECT * INTO o FROM app.billing_operation WHERE workspace_id=p_ws AND id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR o.state='completed' OR a.busy_token IS DISTINCT FROM p_token THEN RETURN false;END IF;
 IF p_action='customer' THEN
  IF p_data->>'id' !~ '^cus_[A-Za-z0-9_]+$' OR(a.customer_id IS NOT NULL AND a.customer_id<>p_data->>'id') THEN RAISE EXCEPTION 'BILLING_CUSTOMER_CHANGED';END IF;
  UPDATE app.billing_account SET customer_id=p_data->>'id' WHERE workspace_id=p_ws;
  UPDATE app.billing_operation SET customer_id=p_data->>'id',stage='remote',updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_id;RETURN true;
 ELSIF p_action NOT IN('awaiting_payment','completed','uncertain','failed') THEN RAISE EXCEPTION 'BILLING_INVALID';END IF;
 UPDATE app.billing_operation SET state=p_action,remote_id=COALESCE(p_data->>'id',remote_id),result=COALESCE(p_data->'result',result),error_code=p_data->>'code',lease_token=NULL,lease_until=NULL,retry_at=clock_timestamp()+CASE WHEN p_data->>'code'='MANUAL_RECONCILIATION' THEN interval '1 day' ELSE interval '30 seconds' END,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_id;
 UPDATE app.billing_account SET busy_token=NULL,busy_until=NULL WHERE workspace_id=p_ws AND busy_token=p_token;RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.billing_claim_operation(text),app.billing_update_operation(text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.billing_claim_operation(text),app.billing_update_operation(text,text,text,text,jsonb) TO cadence_billing;
