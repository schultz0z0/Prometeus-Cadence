-- `unit` collided with a column of the catalog.
CREATE OR REPLACE FUNCTION app.billing_prepare_operation(p_id text, p_request text, p_hash text, p_kind text, p_sku text, p_revision bigint, p_proof jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.billing_account;o app.billing_operation;offer app.billing_catalog;usage jsonb;add_on text;
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
  IF a.subscription_id IS NULL OR p_kind NOT IN('cancel','resume','upgrade','downgrade','payment-method','capacity') THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_REQUIRED';END IF;
  IF p_kind='resume' AND(a.state<>'active' OR NOT a.cancel_at_period_end OR a.period_end<=clock_timestamp()) THEN RAISE EXCEPTION 'BILLING_CHANGED';END IF;
  IF p_kind='capacity' THEN
   add_on:=split_part(p_sku,'-',2);
   IF a.state<>'active' OR a.cancel_at_period_end OR a.change_schedule_id IS NOT NULL OR a.capacity_scheduled ? add_on THEN RAISE EXCEPTION 'BILLING_CHANGED';END IF;
   IF (p_proof->>'quantity')::integer<(p_proof->>'fromQuantity')::integer THEN
    usage:=app.billing_capacity_usage();
    IF (CASE WHEN add_on='seats' THEN (usage->>'seats')::integer+(usage->>'pendingSeats')::integer ELSE (usage->>add_on)::integer END)>(SELECT (c.capacity->>add_on)::integer FROM app.billing_catalog c WHERE c.sku=a.plan)+(p_proof->>'quantity')::integer THEN RAISE EXCEPTION 'BILLING_CAPACITY_IN_USE';END IF;
   END IF;
  END IF;
 END IF;
 INSERT INTO app.billing_operation(workspace_id,id,request_id,actor_id,body_hash,kind,sku,expected_revision,proof,customer_id)
 VALUES(ws,p_id,p_request,current_setting('app.user_id'),p_hash,p_kind,p_sku,p_revision,p_proof,a.customer_id) RETURNING * INTO o;
 INSERT INTO app.audit(workspace_id,user_id,action) VALUES(ws,current_setting('app.user_id'),'billing.'||p_kind);RETURN to_jsonb(o);
END $$;
