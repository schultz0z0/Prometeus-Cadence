CREATE TABLE app.qualification_daily_reservation (
 workspace_id text NOT NULL,
 job_id text NOT NULL,
 lead_id text NOT NULL,
 local_day date NOT NULL,
 funding text NOT NULL CHECK(funding IN('plan','credits')),
 PRIMARY KEY(workspace_id,job_id,lead_id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX qualification_daily_workspace_day ON app.qualification_daily_reservation(workspace_id,local_day);
CREATE INDEX prospecting_inserted_lead_funding ON app.prospecting_item(workspace_id,lead_id,job_id) WHERE status='inserted';
ALTER TABLE app.qualification_daily_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.qualification_daily_reservation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.qualification_daily_reservation FROM PUBLIC,cadence_app,cadence_worker,cadence_billing;

CREATE FUNCTION app.qualification_funding(p_workspace text,p_lead text) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM app.prospecting_item i
  JOIN app.billing_reservation r ON r.workspace_id=i.workspace_id AND r.key='job:'||i.job_id
  WHERE i.workspace_id=p_workspace AND i.lead_id=p_lead AND i.status='inserted'
    AND r.unit='extractions' AND r.funding='credits'
 ) THEN 'credits' ELSE 'plan' END
$$;

CREATE FUNCTION app.qualification_daily_used(p_workspace text,p_day date) RETURNS TABLE(plan integer,credits integer)
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT count(*) FILTER(WHERE r.funding='plan')::integer,count(*) FILTER(WHERE r.funding='credits')::integer
 FROM app.qualification_daily_reservation r
 JOIN app.prospecting_job j ON j.workspace_id=r.workspace_id AND j.id=r.job_id
 WHERE r.workspace_id=p_workspace AND r.local_day=p_day
  AND (j.state NOT IN('completed','partial','failed','cancelled') OR EXISTS(
   SELECT 1 FROM app.prospecting_item i CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.payload->'results','[]'::jsonb)) m
   WHERE i.workspace_id=r.workspace_id AND i.job_id=r.job_id AND i.lead_id=r.lead_id
    AND (m->>'status' IN('succeeded','pending_review') OR m->'reasons' ?| ARRAY['CONTACT_NOT_FOUND','NO_RESULT','AMBIGUOUS_CNPJ'])
  ))
$$;

CREATE FUNCTION app.qualification_daily_balance(p_list text,p_leads jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('limit',(p.allowances->>'extractions')::integer/20,'plan',u.plan,'credits',u.credits,
  'requestedPlan',wanted.plan,'requestedCredits',wanted.credits)
 FROM app.billing_account a JOIN app.billing_catalog p ON p.sku=a.plan
 CROSS JOIN LATERAL app.qualification_daily_used(a.workspace_id,(now() AT TIME ZONE 'America/Sao_Paulo')::date) u
 CROSS JOIN LATERAL (
  SELECT count(*) FILTER(WHERE funding='plan')::integer AS plan,count(*) FILTER(WHERE funding='credits')::integer AS credits
  FROM (SELECT app.qualification_funding(a.workspace_id,l.id) AS funding FROM app.lead l
   WHERE l.workspace_id=a.workspace_id AND l.list_id=p_list AND p_leads ? l.id) selected
 ) wanted
 WHERE a.workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL
  AND a.state='active' AND a.period_start<=now() AND a.period_end>now()
$$;

CREATE FUNCTION app.billing_guard_daily_qualification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE day date; daily_cap integer; used record; request record;
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') OR NEW.kind<>'qualification'
   OR NEW.input ? 'enrichment' OR NEW.input ? 'companyResearch'
   OR NEW.checkpoint->>'purpose'='ai-connection-test' THEN RETURN NEW; END IF;
 SELECT (p.allowances->>'extractions')::integer/20 INTO daily_cap
  FROM app.billing_account a JOIN app.billing_catalog p ON p.sku=a.plan
  WHERE a.workspace_id=NEW.workspace_id AND a.state='active' FOR UPDATE OF a;
 IF NOT FOUND THEN RETURN NEW; END IF;
 day:=(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
 SELECT * INTO used FROM app.qualification_daily_used(NEW.workspace_id,day);
 INSERT INTO app.qualification_daily_reservation(workspace_id,job_id,lead_id,local_day,funding)
 SELECT NEW.workspace_id,NEW.id,l.id,day,app.qualification_funding(NEW.workspace_id,l.id)
 FROM app.lead l WHERE l.workspace_id=NEW.workspace_id AND l.list_id=NEW.list_id AND NEW.input->'leadIds' ? l.id;
 SELECT count(*) FILTER(WHERE funding='plan') AS plan,count(*) FILTER(WHERE funding='credits') AS credits
 INTO request FROM app.qualification_daily_reservation WHERE workspace_id=NEW.workspace_id AND job_id=NEW.id;
 IF (request.plan>0 AND used.plan+request.plan>daily_cap) OR (request.credits>0 AND used.credits+request.credits>daily_cap) THEN
  RAISE EXCEPTION 'BILLING_QUALIFICATION_DAILY_LIMIT';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_guard_daily_qualification AFTER INSERT ON app.prospecting_job
FOR EACH ROW EXECUTE FUNCTION app.billing_guard_daily_qualification();

REVOKE ALL ON FUNCTION app.qualification_funding(text,text),app.qualification_daily_used(text,date),app.qualification_daily_balance(text,jsonb),app.billing_guard_daily_qualification() FROM PUBLIC,cadence_app,cadence_worker,cadence_billing;
GRANT EXECUTE ON FUNCTION app.qualification_daily_balance(text,jsonb) TO cadence_app,cadence_worker;
