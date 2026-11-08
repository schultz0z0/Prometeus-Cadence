CREATE FUNCTION app.billing_guard_credit_purchase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.billing_account;
BEGIN
 IF NEW.kind<>'checkout' OR NOT EXISTS(SELECT 1 FROM app.billing_catalog WHERE sku=NEW.sku AND kind='pack') THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.stage<>'financial_requested' OR OLD.stage='financial_requested' THEN RETURN NEW;END IF;
 END IF;
 SELECT * INTO a FROM app.billing_account WHERE workspace_id=NEW.workspace_id FOR UPDATE;
 IF NOT FOUND OR a.state<>'active' OR COALESCE(a.plan,'') NOT IN('essential','pro','essential-annual','pro-annual')
  OR a.period_start IS NULL OR a.period_end IS NULL OR a.period_start>clock_timestamp() OR a.period_end<=clock_timestamp() THEN
  RAISE EXCEPTION 'BILLING_CREDITS_REQUIRES_PLAN';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.billing_guard_credit_purchase() FROM PUBLIC,cadence_app,cadence_worker,cadence_billing;
CREATE TRIGGER billing_guard_credit_purchase BEFORE INSERT OR UPDATE OF stage ON app.billing_operation
 FOR EACH ROW EXECUTE FUNCTION app.billing_guard_credit_purchase();

CREATE FUNCTION app.billing_extraction_plan_balance() RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.billing_account; ref text; remaining_plan integer;
BEGIN
 IF app.current_role() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO a FROM app.billing_account WHERE workspace_id=current_setting('app.workspace_id',true);
 IF NOT FOUND OR a.state<>'active' OR a.period_start>now() OR a.period_end<=now() THEN RETURN 0;END IF;
 SELECT COALESCE(sum(quantity-spent-held),0)::integer INTO remaining_plan FROM app.billing_grant
  WHERE workspace_id=a.workspace_id AND unit='extractions' AND source='plan' AND NOT revoked
   AND (expires_at IS NULL OR expires_at>now());
 IF a.billing_interval='year' AND a.subscription_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM app.billing_payment WHERE workspace_id=a.workspace_id AND blocked
 ) THEN
  SELECT a.subscription_id||':'||extract(epoch FROM a.period_start)::bigint||':w:'||extract(epoch FROM w.window_start)::bigint
   INTO ref FROM app.billing_month_window(a.period_start,now()) w;
  IF NOT EXISTS(SELECT 1 FROM app.billing_grant WHERE workspace_id=a.workspace_id AND unit='extractions' AND source='plan' AND external_ref=ref) THEN
   SELECT remaining_plan+(allowances->>'extractions')::integer INTO remaining_plan FROM app.billing_catalog WHERE sku=a.plan;
  END IF;
 END IF;
 RETURN COALESCE(remaining_plan,0);
END $$;
REVOKE ALL ON FUNCTION app.billing_extraction_plan_balance() FROM PUBLIC,cadence_app,cadence_worker,cadence_billing;
GRANT EXECUTE ON FUNCTION app.billing_extraction_plan_balance() TO cadence_app,cadence_worker;
