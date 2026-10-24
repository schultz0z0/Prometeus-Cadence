GRANT USAGE ON SCHEMA app TO cadence_billing;
CREATE TABLE app.billing_catalog (
 sku text PRIMARY KEY,version text NOT NULL,kind text NOT NULL CHECK(kind IN('plan','pack')),amount integer NOT NULL CHECK(amount>0),currency text NOT NULL CHECK(currency='brl'),
 unit text,quantity integer,allowances jsonb,capacity jsonb,available boolean NOT NULL DEFAULT true
);
INSERT INTO app.billing_catalog VALUES
 ('essential','2026-10-24-v1','plan',39700,'brl',NULL,NULL,'{"extractions":5000,"imports":5000,"enrichment":50,"sdr":0}','{"seats":2,"mailboxes":3,"whatsapp":2,"cadences":100,"automations":50,"linkedin":0}',true),
 ('pro','2026-10-24-v1','plan',89700,'brl',NULL,NULL,'{"extractions":8000,"imports":15000,"enrichment":50,"sdr":300}','{"seats":3,"mailboxes":5,"whatsapp":3,"cadences":100,"automations":50,"linkedin":1}',true),
 ('extractions-2000','2026-10-24-v1','pack',9700,'brl','extractions',2000,NULL,NULL,true),('extractions-5000','2026-10-24-v1','pack',21900,'brl','extractions',5000,NULL,NULL,true),('extractions-10000','2026-10-24-v1','pack',39900,'brl','extractions',10000,NULL,NULL,true),
 ('imports-5000','2026-10-24-v1','pack',2700,'brl','imports',5000,NULL,NULL,true),('imports-10000','2026-10-24-v1','pack',4700,'brl','imports',10000,NULL,NULL,true),('imports-50000','2026-10-24-v1','pack',14700,'brl','imports',50000,NULL,NULL,true),
 ('enrichment-50','2026-10-24-v1','pack',6500,'brl','enrichment',50,NULL,NULL,false),('enrichment-100','2026-10-24-v1','pack',12000,'brl','enrichment',100,NULL,NULL,false),('enrichment-300','2026-10-24-v1','pack',33000,'brl','enrichment',300,NULL,NULL,false);
CREATE TABLE app.billing_account (
 workspace_id text PRIMARY KEY REFERENCES auth.organization(id),state text NOT NULL DEFAULT 'inactive' CHECK(state IN('inactive','trial','pilot','active','past_due','canceled','attention')),
 plan text REFERENCES app.billing_catalog(sku),period_start timestamptz,period_end timestamptz,trial_started_at timestamptz,trial_request_id text,cutover_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 customer_id text UNIQUE,subscription_id text UNIQUE,cancel_at_period_end boolean NOT NULL DEFAULT false,revision bigint NOT NULL DEFAULT 0,
 contact jsonb NOT NULL DEFAULT '{}',next_plan text,change_schedule_id text,last_synced_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.billing_grant (
 workspace_id text NOT NULL REFERENCES app.billing_account(workspace_id),id text NOT NULL,unit text NOT NULL CHECK(unit IN('extractions','imports','enrichment','sdr')),
 quantity integer NOT NULL CHECK(quantity>=0),spent integer NOT NULL DEFAULT 0 CHECK(spent>=0),held integer NOT NULL DEFAULT 0 CHECK(held>=0),
 source text NOT NULL CHECK(source IN('plan','pack','trial','pilot')),external_ref text NOT NULL,expires_at timestamptz,revoked boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,unit,source,external_ref),CHECK(spent+held<=quantity)
);
CREATE INDEX billing_grant_balance ON app.billing_grant(workspace_id,unit,expires_at);
CREATE TABLE app.billing_reservation (workspace_id text NOT NULL,key text NOT NULL,unit text NOT NULL,quantity integer NOT NULL CHECK(quantity>=0),closed boolean NOT NULL DEFAULT false,PRIMARY KEY(workspace_id,key,unit),FOREIGN KEY(workspace_id) REFERENCES app.billing_account(workspace_id));
CREATE TABLE app.billing_allocation (workspace_id text NOT NULL,key text NOT NULL,unit text NOT NULL,grant_id text NOT NULL,held integer NOT NULL CHECK(held>=0),spent integer NOT NULL DEFAULT 0 CHECK(spent>=0),PRIMARY KEY(workspace_id,key,unit,grant_id),FOREIGN KEY(workspace_id,key,unit) REFERENCES app.billing_reservation(workspace_id,key,unit),FOREIGN KEY(workspace_id,grant_id) REFERENCES app.billing_grant(workspace_id,id));
CREATE TABLE app.billing_consumption (workspace_id text NOT NULL,key text NOT NULL,unit text NOT NULL,quantity integer NOT NULL CHECK(quantity>=0),reservation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,key,unit));
CREATE TABLE app.billing_entry (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id text NOT NULL,operation_key text NOT NULL,unit text NOT NULL,event text NOT NULL CHECK(event IN('grant','reserve','consume','release','freeze')),quantity integer NOT NULL CHECK(quantity>=0),grant_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(workspace_id,grant_id) REFERENCES app.billing_grant(workspace_id,id),UNIQUE(workspace_id,operation_key,unit,event,grant_id));
CREATE TABLE app.billing_operation (
 workspace_id text NOT NULL REFERENCES app.billing_account(workspace_id),id text NOT NULL,request_id text NOT NULL,actor_id text NOT NULL,body_hash text NOT NULL,kind text NOT NULL CHECK(kind IN('checkout','cancel','upgrade','downgrade','payment-method','contact')),
 sku text REFERENCES app.billing_catalog(sku),expected_revision bigint NOT NULL,state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','processing','uncertain','completed','failed')),
 proof jsonb NOT NULL DEFAULT '{}',stage text NOT NULL DEFAULT 'customer',customer_id text,remote_id text,result jsonb,error_code text,lease_token text,lease_until timestamptz,attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,request_id)
);
CREATE UNIQUE INDEX billing_subscription_operation ON app.billing_operation(workspace_id) WHERE kind IN('checkout','upgrade','downgrade','cancel') AND state IN('prepared','processing','uncertain');
CREATE TABLE app.billing_event_inbox (id text PRIMARY KEY,type text NOT NULL,object_id text NOT NULL,customer_id text,created bigint NOT NULL,body_hash text NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','done','attention')),attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),lease_token text,lease_until timestamptz,error_code text,received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.billing_invoice (workspace_id text NOT NULL REFERENCES app.billing_account(workspace_id),id text NOT NULL,subscription_id text,status text NOT NULL,amount integer NOT NULL,currency text NOT NULL CHECK(currency='brl'),url text,created_at timestamptz NOT NULL,PRIMARY KEY(workspace_id,id));
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['billing_account','billing_grant','billing_reservation','billing_allocation','billing_consumption','billing_entry','billing_operation','billing_invoice'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_billing',t);
  EXECUTE format('CREATE POLICY workspace_read ON app.%I FOR SELECT TO cadence_app,cadence_worker USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
  EXECUTE format('CREATE POLICY billing_read ON app.%I FOR SELECT TO cadence_billing USING(true)',t);
  EXECUTE format('GRANT SELECT ON app.%I TO cadence_app,cadence_worker,cadence_billing',t);
 END LOOP;
END $$;
REVOKE ALL ON app.billing_catalog,app.billing_event_inbox FROM PUBLIC,cadence_app,cadence_worker,cadence_billing;
GRANT SELECT ON app.billing_catalog TO cadence_app,cadence_worker,cadence_billing;
GRANT SELECT ON app.billing_event_inbox TO cadence_billing;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM cadence_billing;

CREATE FUNCTION app.billing_new_workspace() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN INSERT INTO app.billing_account(workspace_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION app.billing_new_workspace() FROM PUBLIC;
CREATE TRIGGER billing_new_workspace AFTER INSERT ON auth.organization FOR EACH ROW EXECUTE FUNCTION app.billing_new_workspace();
-- Existing local workspaces retain an explicit one-off pilot; no historical lead is charged.
INSERT INTO app.billing_account(workspace_id,state,plan,period_start,period_end) SELECT id,'pilot','essential',now(),now()+interval '7 days' FROM auth.organization;
INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref,expires_at)
 SELECT a.workspace_id,'pilot:'||a.workspace_id||':'||u.key,u.key,u.value::integer,'pilot','cutover-067',a.period_end FROM app.billing_account a CROSS JOIN app.billing_catalog p CROSS JOIN LATERAL jsonb_each_text(p.allowances) u WHERE p.sku='essential';

CREATE FUNCTION app.billing_require_execution(p_workspace text DEFAULT current_setting('app.workspace_id',true)) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF session_user NOT IN('cadence_billing','cadence_dispatcher') AND (p_workspace IS DISTINCT FROM current_setting('app.workspace_id',true) OR app.current_role() IS NULL) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF NOT EXISTS(SELECT 1 FROM app.billing_account WHERE workspace_id=p_workspace AND state IN('active','trial','pilot') AND period_start<=clock_timestamp() AND period_end>clock_timestamp()) THEN RAISE EXCEPTION 'BILLING_REQUIRED';END IF;
END $$;
CREATE FUNCTION app.billing_start_trial(p_request text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.billing_account;t timestamptz:=clock_timestamp();u record;
BEGIN
 IF app.current_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO a FROM app.billing_account WHERE workspace_id=ws FOR UPDATE;
 IF a.trial_request_id=p_request AND a.trial_started_at IS NOT NULL THEN RETURN to_jsonb(a);END IF;
 IF a.trial_started_at IS NOT NULL THEN RAISE EXCEPTION 'TRIAL_ALREADY_USED';END IF;
 IF a.state='active' AND a.period_end>t THEN RAISE EXCEPTION 'SUBSCRIPTION_ACTIVE';END IF;
 IF p_request IS NULL OR length(p_request)>120 THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 UPDATE app.billing_grant SET revoked=true WHERE workspace_id=ws AND source='pilot';
 UPDATE app.billing_account SET state='trial',plan='essential',period_start=t,period_end=t+interval '168 hours',trial_started_at=t,trial_request_id=p_request,revision=revision+1,updated_at=t WHERE workspace_id=ws RETURNING * INTO a;
 FOR u IN SELECT key,value FROM jsonb_each_text((SELECT allowances FROM app.billing_catalog WHERE sku='essential')) LOOP
  INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref,expires_at) VALUES(ws,'trial:'||ws||':'||u.key,u.key,u.value::integer,'trial','trial:'||ws,a.period_end);
  INSERT INTO app.billing_entry(workspace_id,operation_key,unit,event,quantity,grant_id) VALUES(ws,'trial:'||ws,u.key,'grant',u.value::integer,'trial:'||ws||':'||u.key);
 END LOOP;
 INSERT INTO app.audit(workspace_id,user_id,action) VALUES(ws,current_setting('app.user_id'),'billing.trial');RETURN to_jsonb(a);
END $$;

CREATE FUNCTION app.billing_reserve(p_key text,p_unit text,p_quantity integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);old app.billing_reservation;g app.billing_grant;remaining integer:=p_quantity;take integer;
BEGIN
 IF app.current_role() IS NULL OR p_key IS NULL OR length(p_key)>240 OR p_quantity<0 OR p_quantity>1000000 OR p_unit NOT IN('extractions','imports','enrichment','sdr') THEN RAISE EXCEPTION 'BILLING_INVALID';END IF;
 PERFORM 1 FROM app.billing_account WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO old FROM app.billing_reservation WHERE workspace_id=ws AND key=p_key AND unit=p_unit;
 IF FOUND THEN IF old.quantity<>p_quantity THEN RAISE EXCEPTION 'BILLING_REPLAY_CHANGED';END IF;RETURN;END IF;
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
CREATE FUNCTION app.billing_consume(p_key text,p_unit text,p_quantity integer,p_reservation text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);old app.billing_consumption;a app.billing_allocation;remaining integer:=p_quantity;take integer;hold text:=COALESCE(p_reservation,'direct:'||p_key);
BEGIN
 IF app.current_role() IS NULL OR p_quantity<0 OR p_quantity>1000000 OR p_key IS NULL OR length(p_key)>240 THEN RAISE EXCEPTION 'BILLING_INVALID';END IF;
 PERFORM 1 FROM app.billing_account WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO old FROM app.billing_consumption WHERE workspace_id=ws AND key=p_key AND unit=p_unit;
 IF FOUND THEN IF old.quantity<>p_quantity OR old.reservation_key<>hold THEN RAISE EXCEPTION 'BILLING_REPLAY_CHANGED';END IF;RETURN;END IF;
 IF p_reservation IS NULL THEN PERFORM app.billing_reserve(hold,p_unit,p_quantity);END IF;
 IF NOT EXISTS(SELECT 1 FROM app.billing_reservation WHERE workspace_id=ws AND key=hold AND unit=p_unit AND NOT closed) OR (SELECT COALESCE(sum(held),0) FROM app.billing_allocation WHERE workspace_id=ws AND key=hold AND unit=p_unit)<p_quantity THEN RAISE EXCEPTION 'BILLING_RESERVATION';END IF;
 FOR a IN SELECT x.* FROM app.billing_allocation x JOIN app.billing_grant g ON g.workspace_id=x.workspace_id AND g.id=x.grant_id WHERE x.workspace_id=ws AND x.key=hold AND x.unit=p_unit AND x.held>0 ORDER BY (g.source='pack'),g.expires_at NULLS LAST,g.created_at,g.id FOR UPDATE OF x LOOP
  EXIT WHEN remaining=0;take:=least(remaining,a.held);
  UPDATE app.billing_allocation SET held=held-take,spent=spent+take WHERE workspace_id=ws AND key=hold AND unit=p_unit AND grant_id=a.grant_id;
  UPDATE app.billing_grant SET held=held-take,spent=spent+take WHERE workspace_id=ws AND id=a.grant_id;
  INSERT INTO app.billing_entry(workspace_id,operation_key,unit,event,quantity,grant_id) VALUES(ws,p_key,p_unit,'consume',take,a.grant_id);remaining:=remaining-take;
 END LOOP;
 INSERT INTO app.billing_consumption(workspace_id,key,unit,quantity,reservation_key) VALUES(ws,p_key,p_unit,p_quantity,hold);
 IF p_reservation IS NULL THEN UPDATE app.billing_reservation SET closed=true WHERE workspace_id=ws AND key=hold AND unit=p_unit;END IF;
END $$;
CREATE FUNCTION app.billing_release(p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.billing_allocation;
BEGIN
 IF app.current_role() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM 1 FROM app.billing_account WHERE workspace_id=ws FOR UPDATE;
 FOR a IN SELECT * FROM app.billing_allocation WHERE workspace_id=ws AND key=p_key AND held>0 FOR UPDATE LOOP
  UPDATE app.billing_grant SET held=held-a.held WHERE workspace_id=ws AND id=a.grant_id;
  UPDATE app.billing_allocation SET held=0 WHERE workspace_id=ws AND key=p_key AND unit=a.unit AND grant_id=a.grant_id;
  INSERT INTO app.billing_entry(workspace_id,operation_key,unit,event,quantity,grant_id) VALUES(ws,p_key,a.unit,'release',a.held,a.grant_id);
 END LOOP;
 UPDATE app.billing_reservation SET closed=true WHERE workspace_id=ws AND key=p_key;
END $$;
REVOKE ALL ON FUNCTION app.billing_require_execution(text),app.billing_start_trial(text),app.billing_reserve(text,text,integer),app.billing_consume(text,text,integer,text),app.billing_release(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.billing_start_trial(text) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.billing_require_execution(text) TO cadence_app,cadence_worker,cadence_dispatcher;
GRANT EXECUTE ON FUNCTION app.billing_reserve(text,text,integer),app.billing_consume(text,text,integer,text),app.billing_release(text) TO cadence_app,cadence_worker;

CREATE FUNCTION app.billing_capacity_usage() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);BEGIN
 IF app.current_role() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 RETURN jsonb_build_object(
 'seats',(SELECT count(*) FROM auth.member WHERE "organizationId"=ws),
 'pendingSeats',(SELECT count(*) FROM auth.invitation WHERE "organizationId"=ws AND status='pending' AND "expiresAt">clock_timestamp()),
 'mailboxes',(SELECT count(*) FROM app.channel_connection WHERE workspace_id=ws AND channel='EMAIL' AND archived_at IS NULL AND state<>'disconnected'),
 'whatsapp',(SELECT count(*) FROM app.channel_connection WHERE workspace_id=ws AND channel='WHATSAPP' AND archived_at IS NULL AND state<>'disconnected'),
 'cadences',(SELECT count(*) FROM app.cadence WHERE workspace_id=ws AND payload->>'status'='active'),
 'automations',(SELECT count(*) FROM app.automation_runtime WHERE workspace_id=ws AND status='active'));
END $$;
REVOKE ALL ON FUNCTION app.billing_capacity_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.billing_capacity_usage() TO cadence_app;
