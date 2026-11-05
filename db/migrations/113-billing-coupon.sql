-- 06G.3: a coupon is a platform campaign over a coupon that exists in Stripe. Closed to the application roles: only these functions touch it.
CREATE TABLE app.billing_coupon(code text PRIMARY KEY CHECK(code ~ '^[A-Z0-9_-]{3,40}$'),stripe_coupon_id text NOT NULL CHECK(stripe_coupon_id ~ '^[A-Za-z0-9_]{1,100}$'),valid_until timestamptz NOT NULL,max_uses integer NOT NULL CHECK(max_uses>0),active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE app.billing_coupon_claim(workspace_id text NOT NULL REFERENCES app.billing_account(workspace_id) ON DELETE CASCADE,code text NOT NULL REFERENCES app.billing_coupon(code),operation_id text NOT NULL,state text NOT NULL DEFAULT 'claimed' CHECK(state IN('claimed','redeemed')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,code));
CREATE INDEX billing_coupon_claim_code ON app.billing_coupon_claim(code);
ALTER TABLE app.billing_coupon ENABLE ROW LEVEL SECURITY;ALTER TABLE app.billing_coupon FORCE ROW LEVEL SECURITY;
ALTER TABLE app.billing_coupon_claim ENABLE ROW LEVEL SECURITY;ALTER TABLE app.billing_coupon_claim FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.billing_coupon,app.billing_coupon_claim FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing;
-- One refusal for every reason, so a guess does not learn which codes exist.
CREATE FUNCTION app.billing_check_coupon(p_code text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);c app.billing_coupon;
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO c FROM app.billing_coupon WHERE code=p_code AND active AND valid_until>clock_timestamp();
 IF NOT FOUND OR (SELECT count(*) FROM app.billing_coupon_claim WHERE code=p_code)>=c.max_uses OR EXISTS(SELECT 1 FROM app.billing_coupon_claim WHERE workspace_id=ws AND code=p_code) THEN RAISE EXCEPTION 'BILLING_COUPON_INVALID';END IF;
 RETURN c.stripe_coupon_id;
END $$;
-- The review only showed a price; the use is taken here, one at a time per campaign.
CREATE FUNCTION app.billing_claim_coupon(p_ws text,p_code text,p_stripe text,p_operation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.billing_coupon;
BEGIN
 SELECT * INTO c FROM app.billing_coupon WHERE code=p_code FOR UPDATE;
 IF NOT FOUND OR NOT c.active OR c.valid_until<=clock_timestamp() OR c.stripe_coupon_id IS DISTINCT FROM p_stripe OR (SELECT count(*) FROM app.billing_coupon_claim WHERE code=p_code)>=c.max_uses OR EXISTS(SELECT 1 FROM app.billing_coupon_claim WHERE workspace_id=p_ws AND code=p_code) THEN RAISE EXCEPTION 'BILLING_COUPON_INVALID';END IF;
 INSERT INTO app.billing_coupon_claim(workspace_id,code,operation_id) VALUES(p_ws,p_code,p_operation);
END $$;
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
  IF p_proof ? 'coupon' THEN
   IF offer.kind<>'pack' THEN RAISE EXCEPTION 'BILLING_COUPON_INVALID';END IF;
   PERFORM app.billing_claim_coupon(ws,p_proof->>'coupon',p_proof->>'couponId',p_id);
  END IF;
 ELSE
  IF a.subscription_id IS NULL OR p_kind NOT IN('cancel','resume','upgrade','downgrade','payment-method','capacity') THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_REQUIRED';END IF;
  IF p_kind='resume' AND(a.state<>'active' OR NOT a.cancel_at_period_end OR a.period_end<=clock_timestamp()) THEN RAISE EXCEPTION 'BILLING_CHANGED';END IF;
  IF p_kind='capacity' THEN
   add_on:=split_part(p_sku,'-',2);
   IF a.state<>'active' OR a.cancel_at_period_end OR a.change_schedule_id IS NOT NULL OR a.capacity_scheduled ? add_on THEN RAISE EXCEPTION 'BILLING_CHANGED';END IF;
   IF (p_proof->>'quantity')::integer<(p_proof->>'fromQuantity')::integer THEN
    usage:=app.billing_capacity_usage();
    IF (CASE WHEN add_on='seats' THEN (usage->>'seats')::integer+(usage->>'pendingSeats')::integer ELSE (usage->>add_on)::integer END)>(SELECT (c.capacity->>add_on)::integer FROM app.billing_catalog c WHERE c.sku=a.plan)+(p_proof->>'quantity')::integer THEN RAISE EXCEPTION 'BILLING_CAPACITY_IN_USE';END IF;
    -- Held from here, under the lock the guards take, so nothing new slips in while Stripe is called.
    UPDATE app.billing_account SET capacity_scheduled=capacity_scheduled||jsonb_build_object(add_on,(p_proof->>'quantity')::integer) WHERE workspace_id=ws;
   END IF;
  END IF;
 END IF;
 INSERT INTO app.billing_operation(workspace_id,id,request_id,actor_id,body_hash,kind,sku,expected_revision,proof,customer_id)
 VALUES(ws,p_id,p_request,current_setting('app.user_id'),p_hash,p_kind,p_sku,p_revision,p_proof,a.customer_id) RETURNING * INTO o;
 INSERT INTO app.audit(workspace_id,user_id,action) VALUES(ws,current_setting('app.user_id'),'billing.'||p_kind);RETURN to_jsonb(o);
END $$;
CREATE OR REPLACE FUNCTION app.billing_update_operation(p_ws text, p_id text, p_token text, p_action text, p_data jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $$
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
 END IF;
 IF saved AND p_action='failed' THEN
  DELETE FROM app.billing_coupon_claim WHERE workspace_id=p_ws AND operation_id=p_id AND state='claimed';
  SELECT * INTO o FROM app.billing_operation WHERE workspace_id=p_ws AND id=p_id;
  IF o.kind='capacity' AND (o.proof->>'quantity')::integer<(o.proof->>'fromQuantity')::integer THEN UPDATE app.billing_account SET capacity_scheduled=capacity_scheduled-split_part(o.sku,'-',2) WHERE workspace_id=p_ws;END IF;
 END IF;RETURN saved;
END $$;
CREATE OR REPLACE FUNCTION app.billing_apply_event(p_id text, p_token text, p_data jsonb, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $$
DECLARE wstart timestamptz;wend timestamptz;e app.billing_event_inbox;a app.billing_account;ws text;pay app.billing_payment;offer app.billing_catalog;u record;g app.billing_grant;ref text;expires timestamptz;qty integer;delta integer;newstate text;changed boolean:=false;op app.billing_operation;capacity_invoice boolean:=COALESCE((p_data->>'capacity_invoice')::boolean,false);
BEGIN
 SELECT * INTO e FROM app.billing_event_inbox WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() AND state='processing' FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO a FROM app.billing_account WHERE customer_id=e.customer_id FOR UPDATE;ws:=a.workspace_id;
 IF ws IS NOT NULL AND a.busy_token IS DISTINCT FROM p_token THEN RETURN false;END IF;
 IF p_error IS NOT NULL THEN
  UPDATE app.billing_event_inbox SET state=CASE WHEN attempts>=8 THEN 'attention' ELSE 'pending' END,error_code=p_error,next_at=clock_timestamp()+make_interval(secs=>least(3600,30*attempts)),lease_token=NULL,lease_until=NULL WHERE id=p_id;
 ELSE
  IF p_data->>'kind'='freeze' THEN
   FOR pay IN SELECT * FROM app.billing_payment WHERE workspace_id=ws AND payment_intent=p_data->>'payment_intent' FOR UPDATE LOOP
    UPDATE app.billing_payment SET blocked=true WHERE workspace_id=ws AND id=pay.id;
    SELECT * INTO op FROM app.billing_operation WHERE workspace_id=ws AND kind='capacity' AND result->>'invoiceId'=pay.id;
    -- Only what this payment added, once, and not after a renewal has paid for the quantity again.
    IF FOUND AND NOT pay.blocked AND op.created_at>=a.period_start THEN UPDATE app.billing_account SET capacity_extra=capacity_extra||jsonb_build_object(split_part(op.sku,'-',2),greatest(0,COALESCE((capacity_extra->>split_part(op.sku,'-',2))::integer,0)-((op.proof->>'quantity')::integer-(op.proof->>'fromQuantity')::integer))) WHERE workspace_id=ws;END IF;
    FOR g IN SELECT * FROM app.billing_grant WHERE workspace_id=ws AND(external_ref=pay.grant_ref OR starts_with(external_ref,pay.grant_ref||':w:') OR(source='plan' AND unit='enrichment' AND expires_at>clock_timestamp() AND pay.sku IN('essential','pro'))) AND NOT revoked AND NOT starts_with(pay.grant_ref,'capacity:') FOR UPDATE LOOP
     UPDATE app.billing_grant SET revoked=true WHERE workspace_id=ws AND id=g.id;
     INSERT INTO app.billing_entry(workspace_id,operation_key,unit,event,quantity,grant_id) VALUES(ws,'freeze:'||pay.id,g.unit,'freeze',g.quantity-g.spent,g.id) ON CONFLICT DO NOTHING;
    END LOOP;changed:=true;
   END LOOP;
   IF changed THEN UPDATE app.billing_account SET state='attention',revision=revision+1 WHERE workspace_id=ws;END IF;
  ELSIF p_data->>'kind'='pack' THEN
   SELECT * INTO offer FROM app.billing_catalog WHERE sku=p_data->>'sku' AND kind='pack' AND available;
   IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_INVALID';END IF;
   INSERT INTO app.billing_payment VALUES(ws,p_data->>'payment_id',p_data->>'payment_intent',p_data->>'payment_id',offer.sku,false) ON CONFLICT DO NOTHING;
   SELECT * INTO pay FROM app.billing_payment WHERE workspace_id=ws AND id=p_data->>'payment_id';
   IF NOT pay.blocked THEN
    INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref) VALUES(ws,'pack:'||pay.id,offer.unit,offer.quantity,'pack',pay.grant_ref) ON CONFLICT DO NOTHING;
    INSERT INTO app.billing_entry(workspace_id,operation_key,unit,event,quantity,grant_id) VALUES(ws,pay.id,offer.unit,'grant',offer.quantity,'pack:'||pay.id) ON CONFLICT DO NOTHING;
   END IF;
   UPDATE app.billing_operation SET state='completed',error_code=NULL,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_data->>'operation_id' AND remote_id=p_data->>'payment_id';
   UPDATE app.billing_coupon_claim SET state='redeemed' WHERE workspace_id=ws AND operation_id=p_data->>'operation_id';
  ELSIF p_data->>'kind'='subscription' THEN
   IF a.subscription_id IS NOT NULL AND a.subscription_id<>p_data->>'subscription_id' THEN
  IF EXISTS(SELECT 1 FROM app.billing_subscription_history WHERE workspace_id=ws AND subscription_id=p_data->>'subscription_id') THEN
   UPDATE app.billing_event_inbox SET state='done',error_code=NULL,lease_token=NULL,lease_until=NULL WHERE id=p_id;
   UPDATE app.billing_account SET busy_token=NULL,busy_until=NULL WHERE workspace_id=ws AND busy_token=p_token;RETURN true;
  END IF;
  IF a.state NOT IN('canceled','inactive') OR NOT COALESCE((p_data->>'paid')::boolean,false) OR NOT EXISTS(SELECT 1 FROM app.billing_operation WHERE workspace_id=ws AND id=p_data->>'approved_operation_id' AND kind='checkout' AND sku=COALESCE(p_data->>'sku',p_data->>'plan') AND state='awaiting_payment' AND customer_id=a.customer_id AND remote_id=p_data->>'approved_session_id') THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_CHANGED';END IF;
  INSERT INTO app.billing_subscription_history(workspace_id,subscription_id,replacement_id) VALUES(ws,a.subscription_id,p_data->>'subscription_id');
  UPDATE app.billing_grant SET revoked=true WHERE workspace_id=ws AND source='plan' AND unit<>'enrichment' AND starts_with(external_ref,a.subscription_id||':');
  UPDATE app.billing_account SET subscription_id=p_data->>'subscription_id',next_plan=NULL,change_schedule_id=NULL,capacity_extra='{}',capacity_scheduled='{}' WHERE workspace_id=ws;a.subscription_id:=p_data->>'subscription_id';
 END IF;
   newstate:=CASE p_data->>'status' WHEN 'canceled' THEN 'canceled' WHEN 'unpaid' THEN 'past_due' WHEN 'past_due' THEN 'past_due' WHEN 'paused' THEN 'past_due' ELSE a.state END;
   IF (p_data->>'paid')::boolean THEN
    SELECT * INTO offer FROM app.billing_catalog WHERE sku=p_data->>'plan' AND kind='plan';IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_INVALID';END IF;
    ref:=CASE WHEN capacity_invoice THEN 'capacity:'||(p_data->>'invoice_id') ELSE (p_data->>'subscription_id')||':'||(p_data->>'period_start') END;
    INSERT INTO app.billing_payment VALUES(ws,p_data->>'invoice_id',p_data->>'payment_intent',ref,offer.sku,false) ON CONFLICT DO NOTHING;
    SELECT * INTO pay FROM app.billing_payment WHERE workspace_id=ws AND id=p_data->>'invoice_id';
    IF NOT pay.blocked AND NOT EXISTS(SELECT 1 FROM app.billing_payment WHERE workspace_id=ws AND blocked) THEN
     newstate:='active';
     UPDATE app.billing_grant SET revoked=true WHERE workspace_id=ws AND source IN('trial','pilot');
     IF NOT capacity_invoice THEN FOR u IN SELECT key,value FROM jsonb_each_text(offer.allowances) LOOP
      expires:=to_timestamp((p_data->>'period_end')::bigint);qty:=u.value::integer;
      -- Enrichment is a calendar-month allowance, separate from the paid anniversary.
      IF u.key='enrichment' THEN ref:='calendar:'||to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM');expires:=least(expires,date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 month');
      -- An annual payment opens one monthly window at a time; billing_roll_annual opens the next ones.
      ELSIF p_data->>'interval'='year' THEN SELECT w.window_start,w.window_end INTO wstart,wend FROM app.billing_month_window(to_timestamp((p_data->>'period_start')::bigint),clock_timestamp()) w;ref:=pay.grant_ref||':w:'||extract(epoch FROM wstart)::bigint;expires:=least(expires,wend);
      ELSE ref:=pay.grant_ref;END IF;
      SELECT * INTO g FROM app.billing_grant WHERE workspace_id=ws AND unit=u.key AND source='plan' AND external_ref=ref FOR UPDATE;
      IF NOT FOUND THEN
       INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref,expires_at) VALUES(ws,'plan:'||ref||':'||u.key,u.key,qty,'plan',ref,expires) RETURNING * INTO g;delta:=qty;
      ELSE delta:=greatest(0,qty-g.quantity);UPDATE app.billing_grant SET quantity=greatest(quantity,qty),expires_at=greatest(expires_at,expires) WHERE workspace_id=ws AND id=g.id;END IF;
      INSERT INTO app.billing_entry(workspace_id,operation_key,unit,event,quantity,grant_id) VALUES(ws,pay.id,u.key,'grant',delta,g.id) ON CONFLICT DO NOTHING;
     END LOOP;END IF;
     -- A whole new period paid for what the subscription holds: only here does a Stripe quantity become a right.
     IF COALESCE((p_data->>'whole_period')::boolean,false) AND a.period_start IS DISTINCT FROM to_timestamp((p_data->>'period_start')::bigint) THEN UPDATE app.billing_account SET capacity_extra=COALESCE(p_data->'capacity','{}'),capacity_scheduled='{}' WHERE workspace_id=ws;END IF;
     IF p_data->>'capacity_paid_operation_id' IS NOT NULL THEN
      SELECT * INTO op FROM app.billing_operation WHERE workspace_id=ws AND id=p_data->>'capacity_paid_operation_id' AND kind='capacity' AND state='awaiting_payment' FOR UPDATE;
      IF FOUND THEN
       UPDATE app.billing_account SET capacity_extra=capacity_extra||jsonb_build_object(split_part(op.sku,'-',2),(op.proof->>'quantity')::integer) WHERE workspace_id=ws;
       UPDATE app.billing_operation SET state='completed',error_code=NULL,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=op.id;
      END IF;
     END IF;
     -- The period belongs to the renewal; an add-on invoice must not move it past an unprocessed one.
     IF NOT capacity_invoice THEN UPDATE app.billing_account SET plan=offer.sku,billing_interval=COALESCE(p_data->>'interval','month'),period_start=to_timestamp((p_data->>'period_start')::bigint),period_end=to_timestamp((p_data->>'period_end')::bigint) WHERE workspace_id=ws;END IF;
     UPDATE app.billing_operation SET state='completed',error_code=NULL,updated_at=clock_timestamp() WHERE workspace_id=ws AND state='awaiting_payment' AND((kind='checkout' AND sku IN('essential','pro','essential-annual','pro-annual')) OR(kind='upgrade' AND id=p_data->>'upgrade_paid_operation_id'));
    ELSE newstate:='attention';END IF;
   END IF;
   IF EXISTS(SELECT 1 FROM app.billing_payment WHERE workspace_id=ws AND blocked) THEN newstate:='attention';END IF;
   -- Stripe below the paid quantity means a reduction waiting for the renewal.
   IF p_data ? 'capacity' AND NOT EXISTS(SELECT 1 FROM app.billing_operation WHERE workspace_id=ws AND kind='capacity' AND state IN('prepared','processing','uncertain')) THEN UPDATE app.billing_account SET capacity_scheduled=(SELECT COALESCE(jsonb_object_agg(k.key,COALESCE((p_data->'capacity'->>k.key)::integer,0)),'{}') FROM jsonb_each_text(capacity_extra) k WHERE COALESCE((p_data->'capacity'->>k.key)::integer,0)<k.value::integer) WHERE workspace_id=ws;END IF;
   IF p_data->>'status'='canceled' THEN newstate:='canceled';UPDATE app.billing_account SET capacity_extra='{}',capacity_scheduled='{}' WHERE workspace_id=ws;END IF;
   UPDATE app.billing_account SET state=newstate,subscription_id=p_data->>'subscription_id',cancel_at_period_end=COALESCE((p_data->>'cancel_at_period_end')::boolean,false),last_synced_at=clock_timestamp(),revision=revision+CASE WHEN state IS DISTINCT FROM newstate OR cancel_at_period_end IS DISTINCT FROM COALESCE((p_data->>'cancel_at_period_end')::boolean,false) OR plan IS DISTINCT FROM p_data->>'plan' OR plan IS DISTINCT FROM a.plan OR billing_interval IS DISTINCT FROM a.billing_interval OR capacity_extra IS DISTINCT FROM a.capacity_extra THEN 1 ELSE 0 END,updated_at=clock_timestamp() WHERE workspace_id=ws;
  ELSIF p_data->>'kind'='expired' THEN
   UPDATE app.billing_operation SET state='failed',error_code='CHECKOUT_EXPIRED',updated_at=clock_timestamp() WHERE workspace_id=ws AND remote_id=p_data->>'session_id' AND state='awaiting_payment';
   DELETE FROM app.billing_coupon_claim c USING app.billing_operation o WHERE c.workspace_id=ws AND c.state='claimed' AND o.workspace_id=ws AND o.id=c.operation_id AND o.remote_id=p_data->>'session_id' AND o.state='failed';
  END IF;
  IF p_data->>'upgrade_expired_operation_id' IS NOT NULL THEN
 UPDATE app.billing_operation SET state='failed',error_code='UPGRADE_EXPIRED',updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_data->>'upgrade_expired_operation_id' AND kind IN('upgrade','capacity') AND state='awaiting_payment' AND result->>'invoiceId'=p_data->>'expired_invoice_id';END IF;
 IF p_data->'invoice' IS NOT NULL THEN
   INSERT INTO app.billing_invoice(workspace_id,id,subscription_id,status,amount,currency,url,created_at) VALUES(ws,p_data->'invoice'->>'id',p_data->'invoice'->>'subscription_id',p_data->'invoice'->>'status',(p_data->'invoice'->>'amount')::integer,'brl',p_data->'invoice'->>'url',to_timestamp((p_data->'invoice'->>'created')::bigint)) ON CONFLICT(workspace_id,id) DO UPDATE SET status=EXCLUDED.status,amount=EXCLUDED.amount,url=EXCLUDED.url;
  END IF;
  UPDATE app.billing_event_inbox SET state='done',error_code=NULL,lease_token=NULL,lease_until=NULL WHERE id=p_id;
 END IF;
 IF ws IS NOT NULL THEN UPDATE app.billing_account SET busy_token=NULL,busy_until=NULL WHERE workspace_id=ws AND busy_token=p_token;END IF;RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.billing_check_coupon(text),app.billing_claim_coupon(text,text,text,text) FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing;
GRANT EXECUTE ON FUNCTION app.billing_check_coupon(text) TO cadence_app;
