CREATE FUNCTION app.prospecting_plan_units(p_daily integer,p_planning boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN p_planning THEN
  jsonb_build_object('candidates',0,'apifyRuns',0,'apolloPages',0,'jevCalls',20,'codexCalls',20,'openaiCalls',20,'geminiCalls',20)
 ELSE jsonb_build_object('candidates',p_daily*4,'apifyRuns',p_daily*52,'apolloPages',p_daily*2,
  'jevCalls',p_daily*4,'codexCalls',p_daily*8,'openaiCalls',p_daily*8,'geminiCalls',p_daily*8) END
$$;

CREATE FUNCTION app.prospecting_paid_capacity(p_planning boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE daily integer; totals jsonb;
BEGIN
 IF app.current_role() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT (p.allowances->>'extractions')::integer/20 INTO daily
 FROM app.billing_account a JOIN app.billing_catalog p ON p.sku=a.plan
 WHERE a.workspace_id=current_setting('app.workspace_id',true) AND a.state='active'
  AND a.period_start<=now() AND a.period_end>now();
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT jsonb_object_agg(unit,total) INTO totals FROM (
  SELECT u.key AS unit,sum(u.value::numeric) AS total
  FROM app.billing_account a JOIN app.billing_catalog p ON p.sku=a.plan
  CROSS JOIN LATERAL jsonb_each_text(app.prospecting_plan_units((p.allowances->>'extractions')::integer/20,p_planning)) u
  WHERE a.state='active' AND a.period_start<=now() AND a.period_end>now()
  GROUP BY u.key
 ) caps;
 RETURN jsonb_build_object('workspace',app.prospecting_plan_units(daily,p_planning),'global',totals);
END $$;

CREATE OR REPLACE FUNCTION app.reserve_prospecting_usage(p_job text,p_operation text,p_units jsonb,p_workspace_caps jsonb,p_global_caps jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);k text;amount numeric;used_ws numeric;used_global numeric;old_units jsonb;
 planning boolean;paid boolean;limits jsonb;operational jsonb;day_start timestamptz;
BEGIN
 SELECT kind='planning' INTO planning FROM app.prospecting_job WHERE workspace_id=ws AND id=p_job AND actor_id=current_setting('app.user_id',true);
 IF app.current_role() IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('cadence-prospecting-global-usage'));
 SELECT units INTO old_units FROM app.usage_ledger WHERE workspace_id=ws AND operation_id=p_operation AND event='reserve';
 IF FOUND THEN IF old_units<>p_units THEN RAISE EXCEPTION 'USAGE_CONFLICT';END IF;RETURN;END IF;
 limits:=app.prospecting_paid_capacity(planning);paid:=limits IS NOT NULL;
 IF paid THEN p_workspace_caps:=limits->'workspace';p_global_caps:=limits->'global';END IF;
 SELECT p.limits INTO operational FROM app.prospecting_policy p WHERE p.workspace_id=ws;
 IF FOUND THEN
  SELECT jsonb_object_agg(cap.key,least(cap.value::numeric,COALESCE((operational->>cap.key)::numeric,0)))
   INTO p_workspace_caps FROM jsonb_each_text(p_workspace_caps) cap;
 END IF;
 day_start:=date_trunc('day',now(),'America/Sao_Paulo');
 FOR k,amount IN SELECT key,value::numeric FROM jsonb_each_text(p_units) LOOP
  IF k NOT IN('candidates','apifyRuns','apolloPages','jevCalls','codexCalls','openaiCalls','geminiCalls') OR amount<0 OR amount<>trunc(amount) OR amount>1000000000 THEN RAISE EXCEPTION 'INVALID_USAGE';END IF;
  SELECT COALESCE(sum((l.units->>k)::numeric*CASE WHEN l.event='release' THEN -1 WHEN l.event='consume' AND l.created_at<day_start THEN 0 ELSE 1 END) FILTER(WHERE l.workspace_id=ws),0),
   COALESCE(sum((l.units->>k)::numeric*CASE WHEN l.event='release' THEN -1 WHEN l.event='consume' AND l.created_at<day_start THEN 0 ELSE 1 END)
    FILTER(WHERE paid=COALESCE(a.state='active' AND a.period_start<=now() AND a.period_end>now(),false)),0)
   INTO used_ws,used_global
   FROM app.usage_ledger l JOIN app.prospecting_job j ON j.workspace_id=l.workspace_id AND j.id=l.job_id
   LEFT JOIN app.billing_account a ON a.workspace_id=l.workspace_id
   WHERE (NOT paid OR (j.kind='planning')=planning);
  IF used_ws+amount>COALESCE((p_workspace_caps->>k)::numeric,0) THEN
   IF paid AND planning THEN RAISE EXCEPTION 'PLANNING_DAILY_LIMIT';END IF;
   IF paid THEN RAISE EXCEPTION 'USAGE_WORKSPACE_LIMIT';END IF;
   RAISE EXCEPTION 'USAGE_LIMIT';
  END IF;
  IF used_global+amount>COALESCE((p_global_caps->>k)::numeric,0) THEN
   IF paid THEN RAISE EXCEPTION 'USAGE_PLATFORM_LIMIT';END IF;
   RAISE EXCEPTION 'USAGE_LIMIT';
  END IF;
 END LOOP;
 INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units) VALUES(ws,p_job,p_operation,'reserve',p_units);
END $$;

REVOKE ALL ON FUNCTION app.prospecting_plan_units(integer,boolean),app.prospecting_paid_capacity(boolean) FROM PUBLIC,cadence_app,cadence_worker,cadence_billing;
GRANT EXECUTE ON FUNCTION app.prospecting_paid_capacity(boolean) TO cadence_app,cadence_worker;
