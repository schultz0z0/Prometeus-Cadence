ALTER TABLE app.billing_reservation ADD COLUMN funding text CHECK(funding IN('plan','credits'));
ALTER TABLE app.billing_reservation ADD COLUMN local_day date;
CREATE INDEX billing_reservation_extraction_day ON app.billing_reservation(workspace_id,local_day,funding) WHERE unit='extractions';

CREATE FUNCTION app.billing_reserve_extractions(p_key text,p_quantity integer,p_funding text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true); a app.billing_account; old app.billing_reservation;
 g app.billing_grant; remaining integer:=p_quantity; take integer; used bigint; daily_cap integer;
 ts timestamptz; day date;
BEGIN
 IF app.current_role() IS NULL OR p_key IS NULL OR length(p_key)>240 OR p_quantity IS NULL
   OR p_quantity<1 OR p_quantity>500 OR p_funding IS NULL OR p_funding NOT IN('plan','credits') THEN
  RAISE EXCEPTION 'BILLING_INVALID';
 END IF;
 SELECT * INTO a FROM app.billing_account WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO old FROM app.billing_reservation WHERE workspace_id=ws AND key=p_key AND unit='extractions';
 IF FOUND THEN
  IF old.quantity<>p_quantity OR old.funding IS DISTINCT FROM p_funding THEN RAISE EXCEPTION 'BILLING_REPLAY_CHANGED';END IF;
  RETURN;
 END IF;
 ts:=clock_timestamp();
 day:=(ts AT TIME ZONE 'America/Sao_Paulo')::date;
 PERFORM app.billing_open_annual_window(ws,ts);
 PERFORM app.billing_require_execution(ws);
 IF p_funding='credits' AND (a.state<>'active' OR COALESCE(a.plan,'') NOT IN('essential','essential-annual','pro','pro-annual')) THEN
  RAISE EXCEPTION 'BILLING_CREDITS_REQUIRES_PLAN';
 END IF;
 IF a.state='active' THEN
  SELECT (allowances->>'extractions')::integer/20 INTO daily_cap FROM app.billing_catalog WHERE sku=a.plan;
  SELECT COALESCE(sum(x.held+x.spent),0) INTO used FROM app.billing_allocation x
   JOIN app.billing_reservation r USING(workspace_id,key,unit)
   WHERE r.workspace_id=ws AND r.unit='extractions' AND r.local_day=day AND r.funding=p_funding;
  IF used+p_quantity>COALESCE(daily_cap,0) THEN RAISE EXCEPTION 'BILLING_DAILY_LIMIT';END IF;
 END IF;
 INSERT INTO app.billing_reservation(workspace_id,key,unit,quantity,funding,local_day)
 VALUES(ws,p_key,'extractions',p_quantity,p_funding,day);
 FOR g IN SELECT * FROM app.billing_grant
  WHERE workspace_id=ws AND unit='extractions' AND NOT revoked AND quantity>spent+held
   AND (expires_at IS NULL OR expires_at>ts)
   AND source=(CASE WHEN p_funding='credits' THEN 'pack' WHEN a.state='active' THEN 'plan' ELSE a.state END)
  ORDER BY expires_at NULLS LAST,created_at,id FOR UPDATE
 LOOP
  EXIT WHEN remaining=0;
  take:=least(remaining,g.quantity-g.spent-g.held);
  UPDATE app.billing_grant SET held=held+take WHERE workspace_id=ws AND id=g.id;
  INSERT INTO app.billing_allocation VALUES(ws,p_key,'extractions',g.id,take,0);
  INSERT INTO app.billing_entry(workspace_id,operation_key,unit,event,quantity,grant_id)
   VALUES(ws,p_key,'extractions','reserve',take,g.id);
  remaining:=remaining-take;
 END LOOP;
 IF remaining<>0 THEN RAISE EXCEPTION 'BILLING_QUOTA';END IF;
END $$;

REVOKE ALL ON FUNCTION app.billing_reserve_extractions(text,integer,text) FROM PUBLIC,cadence_app,cadence_worker;

CREATE OR REPLACE FUNCTION app.billing_guard_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE needed integer;
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') THEN RETURN NEW;END IF;
 PERFORM app.billing_require_execution(NEW.workspace_id);
 IF NEW.kind='generation' THEN
  IF NEW.source='APOLLO' THEN
   IF NEW.input ? 'funding' THEN RAISE EXCEPTION 'BILLING_INVALID';END IF;
   PERFORM app.billing_reserve('job:'||NEW.id,'imports',(NEW.input->>'limit')::integer);
  ELSE
   PERFORM app.billing_reserve_extractions('job:'||NEW.id,(NEW.input->>'limit')::integer,COALESCE(NEW.input->>'funding','plan'));
  END IF;
 ELSIF NEW.kind='qualification' AND NEW.input ? 'enrichment' THEN
  IF NEW.input->>'companyPeople'='true' THEN
   SELECT count(*) INTO needed FROM jsonb_array_elements(NEW.checkpoint->'enrichment'->'groups') g WHERE g->>'cacheId' IS NULL;
  ELSE
   SELECT count(DISTINCT regexp_replace(upper(l.payload->>'cnpj'),'[^A-Z0-9]','','g')) INTO needed FROM app.lead l WHERE l.workspace_id=NEW.workspace_id AND l.list_id=NEW.list_id AND NEW.input->'leadIds' ? l.id AND l.payload->>'qualification'='qualified' AND NOT EXISTS(SELECT 1 FROM app.enrichment_resolution r WHERE r.workspace_id=l.workspace_id AND r.cnpj=regexp_replace(upper(l.payload->>'cnpj'),'[^A-Z0-9]','','g') AND r.contract=NEW.checkpoint->'enrichment'->>'contract' AND r.expires_at>clock_timestamp());
  END IF;
  PERFORM app.billing_reserve('job:'||NEW.id,'enrichment',least(needed,(NEW.input->'enrichment'->>'maxCredits')::integer));
 END IF;
 RETURN NEW;
END $$;
