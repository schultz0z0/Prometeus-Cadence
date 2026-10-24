CREATE TABLE app.billing_payment(workspace_id text NOT NULL REFERENCES app.billing_account(workspace_id),id text NOT NULL,payment_intent text,grant_ref text NOT NULL,sku text NOT NULL,blocked boolean NOT NULL DEFAULT false,PRIMARY KEY(workspace_id,id));
ALTER TABLE app.billing_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.billing_payment FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.billing_payment FROM PUBLIC,cadence_app,cadence_worker,cadence_billing;
CREATE POLICY billing_read ON app.billing_payment FOR SELECT TO cadence_billing USING(true);
GRANT SELECT ON app.billing_payment TO cadence_billing;

CREATE FUNCTION app.billing_receive_event(p_event jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior text;
BEGIN
 IF length(p_event::text)>4096 OR length(p_event->>'id')>240 OR length(p_event->>'object_id')>240 THEN RAISE EXCEPTION 'BILLING_INVALID';END IF;
 INSERT INTO app.billing_event_inbox(id,type,object_id,customer_id,created,body_hash) VALUES(p_event->>'id',p_event->>'type',p_event->>'object_id',p_event->>'customer_id',(p_event->>'created')::bigint,p_event->>'body_hash') ON CONFLICT DO NOTHING;
 SELECT body_hash INTO prior FROM app.billing_event_inbox WHERE id=p_event->>'id';
 IF prior IS DISTINCT FROM p_event->>'body_hash' THEN RAISE EXCEPTION 'BILLING_REPLAY_CHANGED';END IF;RETURN p_event->>'id';
END $$;
CREATE FUNCTION app.billing_claim_event(p_id text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e app.billing_event_inbox;a app.billing_account;t text:=gen_random_uuid()::text;
BEGIN
 SELECT * INTO e FROM app.billing_event_inbox WHERE (p_id IS NULL OR id=p_id) AND state IN('pending','processing') AND(lease_until IS NULL OR lease_until<clock_timestamp()) AND(p_id IS NOT NULL OR next_at<=clock_timestamp()) ORDER BY received_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO a FROM app.billing_account WHERE customer_id=e.customer_id AND(busy_until IS NULL OR busy_until<clock_timestamp()) FOR UPDATE SKIP LOCKED;
 IF NOT FOUND AND EXISTS(SELECT 1 FROM app.billing_account WHERE customer_id=e.customer_id) THEN RETURN NULL;END IF;
 IF a.workspace_id IS NOT NULL THEN UPDATE app.billing_account SET busy_token=t,busy_until=clock_timestamp()+interval '90 seconds' WHERE workspace_id=a.workspace_id;END IF;
 UPDATE app.billing_event_inbox SET state='processing',lease_token=t,lease_until=clock_timestamp()+interval '90 seconds',attempts=attempts+1 WHERE id=e.id RETURNING * INTO e;
 RETURN to_jsonb(e)||jsonb_build_object('account',CASE WHEN a.workspace_id IS NULL THEN NULL ELSE to_jsonb(a) END);
END $$;

CREATE FUNCTION app.billing_apply_event(p_id text,p_token text,p_data jsonb,p_error text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e app.billing_event_inbox;a app.billing_account;ws text;pay app.billing_payment;offer app.billing_catalog;u record;g app.billing_grant;ref text;expires timestamptz;qty integer;delta integer;newstate text;changed boolean:=false;
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
    FOR g IN SELECT * FROM app.billing_grant WHERE workspace_id=ws AND(external_ref=pay.grant_ref OR(source='plan' AND unit='enrichment' AND expires_at>clock_timestamp() AND pay.sku IN('essential','pro'))) AND NOT revoked FOR UPDATE LOOP
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
  ELSIF p_data->>'kind'='subscription' THEN
   IF a.subscription_id IS NOT NULL AND a.subscription_id<>p_data->>'subscription_id' THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_CHANGED';END IF;
   newstate:=CASE p_data->>'status' WHEN 'canceled' THEN 'canceled' WHEN 'unpaid' THEN 'past_due' WHEN 'past_due' THEN 'past_due' WHEN 'paused' THEN 'past_due' ELSE a.state END;
   IF (p_data->>'paid')::boolean THEN
    SELECT * INTO offer FROM app.billing_catalog WHERE sku=p_data->>'plan' AND kind='plan';IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_INVALID';END IF;
    ref:=(p_data->>'subscription_id')||':'||(p_data->>'period_start');
    INSERT INTO app.billing_payment VALUES(ws,p_data->>'invoice_id',p_data->>'payment_intent',ref,offer.sku,false) ON CONFLICT DO NOTHING;
    SELECT * INTO pay FROM app.billing_payment WHERE workspace_id=ws AND id=p_data->>'invoice_id';
    IF NOT pay.blocked AND NOT EXISTS(SELECT 1 FROM app.billing_payment WHERE workspace_id=ws AND blocked) THEN
     newstate:='active';
     UPDATE app.billing_grant SET revoked=true WHERE workspace_id=ws AND source IN('trial','pilot');
     FOR u IN SELECT key,value FROM jsonb_each_text(offer.allowances) LOOP
      expires:=to_timestamp((p_data->>'period_end')::bigint);qty:=u.value::integer;
      -- Enrichment is a calendar-month allowance, separate from the paid anniversary.
      IF u.key='enrichment' THEN ref:='calendar:'||to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM');expires:=least(expires,date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 month');ELSE ref:=pay.grant_ref;END IF;
      SELECT * INTO g FROM app.billing_grant WHERE workspace_id=ws AND unit=u.key AND source='plan' AND external_ref=ref FOR UPDATE;
      IF NOT FOUND THEN
       INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref,expires_at) VALUES(ws,'plan:'||ref||':'||u.key,u.key,qty,'plan',ref,expires) RETURNING * INTO g;delta:=qty;
      ELSE delta:=greatest(0,qty-g.quantity);UPDATE app.billing_grant SET quantity=greatest(quantity,qty),expires_at=greatest(expires_at,expires) WHERE workspace_id=ws AND id=g.id;END IF;
      INSERT INTO app.billing_entry(workspace_id,operation_key,unit,event,quantity,grant_id) VALUES(ws,pay.id,u.key,'grant',delta,g.id) ON CONFLICT DO NOTHING;
     END LOOP;
     UPDATE app.billing_account SET plan=offer.sku,period_start=to_timestamp((p_data->>'period_start')::bigint),period_end=to_timestamp((p_data->>'period_end')::bigint) WHERE workspace_id=ws;
     UPDATE app.billing_operation SET state='completed',error_code=NULL,updated_at=clock_timestamp() WHERE workspace_id=ws AND state='awaiting_payment' AND((kind='checkout' AND sku IN('essential','pro')) OR kind='upgrade');
    ELSE newstate:='attention';END IF;
   END IF;
   IF EXISTS(SELECT 1 FROM app.billing_payment WHERE workspace_id=ws AND blocked) THEN newstate:='attention';END IF;
   IF p_data->>'status'='canceled' THEN newstate:='canceled';END IF;
   UPDATE app.billing_account SET state=newstate,subscription_id=p_data->>'subscription_id',cancel_at_period_end=COALESCE((p_data->>'cancel_at_period_end')::boolean,false),last_synced_at=clock_timestamp(),revision=revision+CASE WHEN state IS DISTINCT FROM newstate OR cancel_at_period_end IS DISTINCT FROM COALESCE((p_data->>'cancel_at_period_end')::boolean,false) OR plan IS DISTINCT FROM p_data->>'plan' THEN 1 ELSE 0 END,updated_at=clock_timestamp() WHERE workspace_id=ws;
  ELSIF p_data->>'kind'='expired' THEN
   UPDATE app.billing_operation SET state='failed',error_code='CHECKOUT_EXPIRED',updated_at=clock_timestamp() WHERE workspace_id=ws AND remote_id=p_data->>'session_id' AND state='awaiting_payment';
  END IF;
  IF p_data->'invoice' IS NOT NULL THEN
   INSERT INTO app.billing_invoice(workspace_id,id,subscription_id,status,amount,currency,url,created_at) VALUES(ws,p_data->'invoice'->>'id',p_data->'invoice'->>'subscription_id',p_data->'invoice'->>'status',(p_data->'invoice'->>'amount')::integer,'brl',p_data->'invoice'->>'url',to_timestamp((p_data->'invoice'->>'created')::bigint)) ON CONFLICT(workspace_id,id) DO UPDATE SET status=EXCLUDED.status,amount=EXCLUDED.amount,url=EXCLUDED.url;
  END IF;
  UPDATE app.billing_event_inbox SET state='done',error_code=NULL,lease_token=NULL,lease_until=NULL WHERE id=p_id;
 END IF;
 IF ws IS NOT NULL THEN UPDATE app.billing_account SET busy_token=NULL,busy_until=NULL WHERE workspace_id=ws AND busy_token=p_token;END IF;RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.billing_receive_event(jsonb),app.billing_claim_event(text),app.billing_apply_event(text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.billing_receive_event(jsonb),app.billing_claim_event(text),app.billing_apply_event(text,text,jsonb,text) TO cadence_billing;

CREATE FUNCTION app.billing_operation_effect() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.state='completed' AND OLD.state IS DISTINCT FROM 'completed' THEN
  IF NEW.kind='cancel' THEN UPDATE app.billing_account SET cancel_at_period_end=true,revision=revision+1 WHERE workspace_id=NEW.workspace_id;
  ELSIF NEW.kind='downgrade' THEN UPDATE app.billing_account SET next_plan=NEW.sku,change_schedule_id=NEW.remote_id,revision=revision+1 WHERE workspace_id=NEW.workspace_id;END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.billing_operation_effect() FROM PUBLIC;
CREATE TRIGGER billing_operation_effect AFTER UPDATE ON app.billing_operation FOR EACH ROW EXECUTE FUNCTION app.billing_operation_effect();

CREATE FUNCTION app.billing_schedule_sync(p_limit integer DEFAULT 5) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x record;n integer:=0;k text;
BEGIN
 FOR x IN SELECT customer_id,object_id,type FROM(
  SELECT a.customer_id,o.remote_id AS object_id,CASE WHEN o.kind='checkout' THEN 'billing.checkout' ELSE 'billing.reconcile' END AS type,o.updated_at AS due FROM app.billing_operation o JOIN app.billing_account a USING(workspace_id) WHERE o.state='awaiting_payment' AND o.remote_id IS NOT NULL
  UNION ALL SELECT customer_id,subscription_id,'billing.reconcile',COALESCE(last_synced_at,'epoch'::timestamptz) FROM app.billing_account WHERE subscription_id IS NOT NULL AND state IN('active','past_due','attention') AND(last_synced_at IS NULL OR last_synced_at<clock_timestamp()-interval '5 minutes')
 ) q WHERE customer_id IS NOT NULL ORDER BY due LIMIT least(10,greatest(1,p_limit)) LOOP
  k:='sync:'||x.customer_id||':'||x.object_id||':'||floor(extract(epoch FROM clock_timestamp())/30)::text;
  INSERT INTO app.billing_event_inbox(id,type,object_id,customer_id,created,body_hash) VALUES(k,x.type,x.object_id,x.customer_id,extract(epoch FROM clock_timestamp())::bigint,k) ON CONFLICT DO NOTHING;n:=n+1;
 END LOOP;RETURN n;
END $$;
REVOKE ALL ON FUNCTION app.billing_schedule_sync(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.billing_schedule_sync(integer) TO cadence_billing;
