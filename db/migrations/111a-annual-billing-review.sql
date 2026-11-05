-- 06G.1 review fixes.
-- 111 narrowed the guard: resume and a checkout awaiting payment must keep blocking a second operation.
DROP INDEX app.billing_subscription_operation;
CREATE UNIQUE INDEX billing_subscription_operation ON app.billing_operation(workspace_id) WHERE (kind IN('upgrade','downgrade','cancel','resume') OR(kind='checkout' AND sku IN('essential','pro','essential-annual','pro-annual'))) AND state IN('prepared','processing','uncertain','awaiting_payment');
-- One way to open a window, under the account lock: from the worker and from a reservation that arrives first.
CREATE FUNCTION app.billing_open_annual_window(p_ws text,p_now timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.billing_account;wstart timestamptz;wend timestamptz;u record;g app.billing_grant;ref text;expires timestamptz;opened boolean:=false;
BEGIN
 SELECT * INTO a FROM app.billing_account WHERE workspace_id=p_ws FOR UPDATE;
 IF NOT FOUND OR a.state<>'active' OR a.billing_interval<>'year' OR a.plan IS NULL OR a.subscription_id IS NULL OR a.period_end<=p_now OR EXISTS(SELECT 1 FROM app.billing_payment b WHERE b.workspace_id=p_ws AND b.blocked) THEN RETURN false;END IF;
 SELECT w.window_start,w.window_end INTO wstart,wend FROM app.billing_month_window(a.period_start,p_now) w;
 FOR u IN SELECT key,value FROM jsonb_each_text((SELECT allowances FROM app.billing_catalog WHERE sku=a.plan)) LOOP
  IF u.key='enrichment' THEN ref:='calendar:'||to_char(p_now AT TIME ZONE 'UTC','YYYY-MM');expires:=least(a.period_end,date_trunc('month',p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 month');
  ELSE ref:=a.subscription_id||':'||extract(epoch FROM a.period_start)::bigint||':w:'||extract(epoch FROM wstart)::bigint;expires:=least(a.period_end,wend);END IF;
  g:=NULL;
  INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref,expires_at) VALUES(p_ws,'plan:'||ref||':'||u.key,u.key,u.value::integer,'plan',ref,expires) ON CONFLICT DO NOTHING RETURNING * INTO g;
  IF g.id IS NOT NULL THEN opened:=true;INSERT INTO app.billing_entry(workspace_id,operation_key,unit,event,quantity,grant_id) VALUES(p_ws,'window:'||ref,u.key,'grant',u.value::integer,g.id) ON CONFLICT DO NOTHING;END IF;
 END LOOP;
 RETURN opened;
END $$;
-- Due when the monthly window or the calendar-month enrichment is missing. Short locks: busy accounts wait for the next tick.
CREATE OR REPLACE FUNCTION app.billing_roll_annual(p_limit integer,p_now timestamptz) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x record;n integer:=0;
BEGIN
 FOR x IN SELECT a.workspace_id FROM app.billing_account a CROSS JOIN LATERAL app.billing_month_window(a.period_start,p_now) w
  WHERE a.state='active' AND a.billing_interval='year' AND a.plan IS NOT NULL AND a.subscription_id IS NOT NULL AND a.period_end>p_now
   AND NOT EXISTS(SELECT 1 FROM app.billing_payment b WHERE b.workspace_id=a.workspace_id AND b.blocked)
   AND (NOT EXISTS(SELECT 1 FROM app.billing_grant y WHERE y.workspace_id=a.workspace_id AND y.source='plan' AND y.unit='extractions' AND y.external_ref=a.subscription_id||':'||extract(epoch FROM a.period_start)::bigint||':w:'||extract(epoch FROM w.window_start)::bigint)
    OR NOT EXISTS(SELECT 1 FROM app.billing_grant y WHERE y.workspace_id=a.workspace_id AND y.source='plan' AND y.unit='enrichment' AND y.external_ref='calendar:'||to_char(p_now AT TIME ZONE 'UTC','YYYY-MM')))
  ORDER BY a.workspace_id LIMIT greatest(1,least(p_limit,500)) FOR UPDATE OF a SKIP LOCKED LOOP
  IF app.billing_open_annual_window(x.workspace_id,p_now) THEN n:=n+1;END IF;
 END LOOP;
 RETURN n;
END $$;
-- A reservation between two worker ticks spends the new franchise, never the prepaid pack.
CREATE OR REPLACE FUNCTION app.billing_reserve(p_key text, p_unit text, p_quantity integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);old app.billing_reservation;g app.billing_grant;remaining integer:=p_quantity;take integer;
BEGIN
 IF app.current_role() IS NULL OR p_key IS NULL OR length(p_key)>240 OR p_quantity<0 OR p_quantity>1000000 OR p_unit NOT IN('extractions','imports','enrichment','sdr') THEN RAISE EXCEPTION 'BILLING_INVALID';END IF;
 PERFORM 1 FROM app.billing_account WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO old FROM app.billing_reservation WHERE workspace_id=ws AND key=p_key AND unit=p_unit;
 IF FOUND THEN IF old.quantity<>p_quantity THEN RAISE EXCEPTION 'BILLING_REPLAY_CHANGED';END IF;RETURN;END IF;
 PERFORM app.billing_open_annual_window(ws,clock_timestamp());
 PERFORM app.billing_require_execution(ws);
 IF (SELECT COALESCE(sum(quantity-spent-held),0) FROM app.billing_grant WHERE workspace_id=ws AND unit=p_unit AND NOT revoked AND (expires_at IS NULL OR expires_at>clock_timestamp()))<p_quantity THEN RAISE EXCEPTION 'BILLING_QUOTA';END IF;
 INSERT INTO app.billing_reservation VALUES(ws,p_key,p_unit,p_quantity,false);
 FOR g IN SELECT * FROM app.billing_grant WHERE workspace_id=ws AND unit=p_unit AND NOT revoked AND quantity>spent+held AND (expires_at IS NULL OR expires_at>clock_timestamp()) ORDER BY (source='pack'),expires_at NULLS LAST,created_at,id FOR UPDATE LOOP
  EXIT WHEN remaining=0;take:=least(remaining,g.quantity-g.spent-g.held);
  UPDATE app.billing_grant SET held=held+take WHERE workspace_id=ws AND id=g.id;
  INSERT INTO app.billing_allocation VALUES(ws,p_key,p_unit,g.id,take,0);
  INSERT INTO app.billing_entry(workspace_id,operation_key,unit,event,quantity,grant_id) VALUES(ws,p_key,p_unit,'reserve',take,g.id);remaining:=remaining-take;
 END LOOP;
 IF remaining<>0 THEN RAISE EXCEPTION 'BILLING_QUOTA';END IF;
END $$;
CREATE OR REPLACE FUNCTION app.billing_apply_event(p_id text, p_token text, p_data jsonb, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $$
DECLARE wstart timestamptz;wend timestamptz;e app.billing_event_inbox;a app.billing_account;ws text;pay app.billing_payment;offer app.billing_catalog;u record;g app.billing_grant;ref text;expires timestamptz;qty integer;delta integer;newstate text;changed boolean:=false;
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
    FOR g IN SELECT * FROM app.billing_grant WHERE workspace_id=ws AND(external_ref=pay.grant_ref OR starts_with(external_ref,pay.grant_ref||':w:') OR(source='plan' AND unit='enrichment' AND expires_at>clock_timestamp() AND pay.sku IN('essential','pro'))) AND NOT revoked FOR UPDATE LOOP
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
   IF a.subscription_id IS NOT NULL AND a.subscription_id<>p_data->>'subscription_id' THEN
  IF EXISTS(SELECT 1 FROM app.billing_subscription_history WHERE workspace_id=ws AND subscription_id=p_data->>'subscription_id') THEN
   UPDATE app.billing_event_inbox SET state='done',error_code=NULL,lease_token=NULL,lease_until=NULL WHERE id=p_id;
   UPDATE app.billing_account SET busy_token=NULL,busy_until=NULL WHERE workspace_id=ws AND busy_token=p_token;RETURN true;
  END IF;
  IF a.state NOT IN('canceled','inactive') OR NOT COALESCE((p_data->>'paid')::boolean,false) OR NOT EXISTS(SELECT 1 FROM app.billing_operation WHERE workspace_id=ws AND id=p_data->>'approved_operation_id' AND kind='checkout' AND sku=COALESCE(p_data->>'sku',p_data->>'plan') AND state='awaiting_payment' AND customer_id=a.customer_id AND remote_id=p_data->>'approved_session_id') THEN RAISE EXCEPTION 'BILLING_SUBSCRIPTION_CHANGED';END IF;
  INSERT INTO app.billing_subscription_history(workspace_id,subscription_id,replacement_id) VALUES(ws,a.subscription_id,p_data->>'subscription_id');
  UPDATE app.billing_grant SET revoked=true WHERE workspace_id=ws AND source='plan' AND unit<>'enrichment' AND starts_with(external_ref,a.subscription_id||':');
  UPDATE app.billing_account SET subscription_id=p_data->>'subscription_id',next_plan=NULL,change_schedule_id=NULL WHERE workspace_id=ws;a.subscription_id:=p_data->>'subscription_id';
 END IF;
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
      IF u.key='enrichment' THEN ref:='calendar:'||to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM');expires:=least(expires,date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 month');
      -- An annual payment opens one monthly window at a time; billing_roll_annual opens the next ones.
      ELSIF p_data->>'interval'='year' THEN SELECT w.window_start,w.window_end INTO wstart,wend FROM app.billing_month_window(to_timestamp((p_data->>'period_start')::bigint),clock_timestamp()) w;ref:=pay.grant_ref||':w:'||extract(epoch FROM wstart)::bigint;expires:=least(expires,wend);
      ELSE ref:=pay.grant_ref;END IF;
      SELECT * INTO g FROM app.billing_grant WHERE workspace_id=ws AND unit=u.key AND source='plan' AND external_ref=ref FOR UPDATE;
      IF NOT FOUND THEN
       INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref,expires_at) VALUES(ws,'plan:'||ref||':'||u.key,u.key,qty,'plan',ref,expires) RETURNING * INTO g;delta:=qty;
      ELSE delta:=greatest(0,qty-g.quantity);UPDATE app.billing_grant SET quantity=greatest(quantity,qty),expires_at=greatest(expires_at,expires) WHERE workspace_id=ws AND id=g.id;END IF;
      INSERT INTO app.billing_entry(workspace_id,operation_key,unit,event,quantity,grant_id) VALUES(ws,pay.id,u.key,'grant',delta,g.id) ON CONFLICT DO NOTHING;
     END LOOP;
     UPDATE app.billing_account SET plan=offer.sku,billing_interval=COALESCE(p_data->>'interval','month'),period_start=to_timestamp((p_data->>'period_start')::bigint),period_end=to_timestamp((p_data->>'period_end')::bigint) WHERE workspace_id=ws;
     UPDATE app.billing_operation SET state='completed',error_code=NULL,updated_at=clock_timestamp() WHERE workspace_id=ws AND state='awaiting_payment' AND((kind='checkout' AND sku IN('essential','pro','essential-annual','pro-annual')) OR(kind='upgrade' AND id=p_data->>'upgrade_paid_operation_id'));
    ELSE newstate:='attention';END IF;
   END IF;
   IF EXISTS(SELECT 1 FROM app.billing_payment WHERE workspace_id=ws AND blocked) THEN newstate:='attention';END IF;
   IF p_data->>'status'='canceled' THEN newstate:='canceled';END IF;
   UPDATE app.billing_account SET state=newstate,subscription_id=p_data->>'subscription_id',cancel_at_period_end=COALESCE((p_data->>'cancel_at_period_end')::boolean,false),last_synced_at=clock_timestamp(),revision=revision+CASE WHEN state IS DISTINCT FROM newstate OR cancel_at_period_end IS DISTINCT FROM COALESCE((p_data->>'cancel_at_period_end')::boolean,false) OR plan IS DISTINCT FROM p_data->>'plan' OR plan IS DISTINCT FROM a.plan OR billing_interval IS DISTINCT FROM a.billing_interval THEN 1 ELSE 0 END,updated_at=clock_timestamp() WHERE workspace_id=ws;
  ELSIF p_data->>'kind'='expired' THEN
   UPDATE app.billing_operation SET state='failed',error_code='CHECKOUT_EXPIRED',updated_at=clock_timestamp() WHERE workspace_id=ws AND remote_id=p_data->>'session_id' AND state='awaiting_payment';
  END IF;
  IF p_data->>'upgrade_expired_operation_id' IS NOT NULL THEN
 UPDATE app.billing_operation SET state='failed',error_code='UPGRADE_EXPIRED',updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_data->>'upgrade_expired_operation_id' AND kind='upgrade' AND state='awaiting_payment' AND result->>'invoiceId'=p_data->>'expired_invoice_id';END IF;
 IF p_data->'invoice' IS NOT NULL THEN
   INSERT INTO app.billing_invoice(workspace_id,id,subscription_id,status,amount,currency,url,created_at) VALUES(ws,p_data->'invoice'->>'id',p_data->'invoice'->>'subscription_id',p_data->'invoice'->>'status',(p_data->'invoice'->>'amount')::integer,'brl',p_data->'invoice'->>'url',to_timestamp((p_data->'invoice'->>'created')::bigint)) ON CONFLICT(workspace_id,id) DO UPDATE SET status=EXCLUDED.status,amount=EXCLUDED.amount,url=EXCLUDED.url;
  END IF;
  UPDATE app.billing_event_inbox SET state='done',error_code=NULL,lease_token=NULL,lease_until=NULL WHERE id=p_id;
 END IF;
 IF ws IS NOT NULL THEN UPDATE app.billing_account SET busy_token=NULL,busy_until=NULL WHERE workspace_id=ws AND busy_token=p_token;END IF;RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.billing_open_annual_window(text,timestamptz) FROM PUBLIC;
