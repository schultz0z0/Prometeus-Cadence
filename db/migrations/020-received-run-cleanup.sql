-- A receipt is technical evidence for an already dispatched fenced operation.
-- It grants neither a new dispatch nor publication of domain objects.
CREATE OR REPLACE FUNCTION app.record_received_prospecting_step(p_job text,p_token text,p_fence bigint,p_actor text,p_operation text,p_result jsonb,p_usage jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.prospecting_job; a app.prospecting_attempt; unit text; amount numeric; remaining numeric; revoked boolean; rest jsonb;
BEGIN
 IF length(p_job) NOT BETWEEN 1 AND 120 OR length(p_token) NOT BETWEEN 1 AND 120 OR length(p_operation) NOT BETWEEN 1 AND 120 OR p_fence<1 OR p_result IS NULL OR pg_column_size(p_result)>2097152 OR pg_column_size(p_usage)>65536 THEN RAISE EXCEPTION 'INVALID_RECEIPT';END IF;
 SELECT * INTO j FROM app.prospecting_job WHERE id=p_job AND actor_id=p_actor AND lease_token=p_token AND fence=p_fence AND lease_until>clock_timestamp() AND state IN('running','waiting_provider','cancelling') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STALE_JOB';END IF;
 SELECT * INTO a FROM app.prospecting_attempt WHERE workspace_id=j.workspace_id AND job_id=j.id AND id=p_operation FOR UPDATE;
 IF NOT FOUND OR a.state NOT IN('prepared','completed') THEN RAISE EXCEPTION 'INVALID_RECEIPT';END IF;
 IF a.state='completed' THEN IF a.payload->'result'<>p_result THEN RAISE EXCEPTION 'RECEIPT_CONFLICT';END IF;RETURN true;END IF;
 IF p_usage IS NOT NULL THEN
  IF jsonb_typeof(p_usage->'units')<>'object' OR p_usage->>'provider'<>a.provider OR p_usage->>'costKind' NOT IN('unknown','reported','estimated') OR (p_usage->>'costUsd' IS NOT NULL AND ((p_usage->>'costUsd')::numeric<0 OR (p_usage->>'costUsd')::numeric>1000000000)) THEN RAISE EXCEPTION 'INVALID_USAGE';END IF;
  FOR unit,amount IN SELECT key,value::numeric FROM jsonb_each_text(p_usage->'units') LOOP
   IF unit NOT IN('candidates','apifyRuns','apolloPages','jevCalls','codexCalls','openaiCalls','geminiCalls') OR amount<0 OR amount>1000000000 OR amount<>trunc(amount) OR amount>COALESCE((a.payload->'reservedUnits'->>unit)::numeric,0) THEN RAISE EXCEPTION 'INVALID_USAGE';END IF;
   SELECT COALESCE(sum((l.units->>unit)::numeric*CASE WHEN l.event='reserve' THEN 1 ELSE -1 END),0) INTO remaining FROM app.usage_ledger l WHERE l.workspace_id=j.workspace_id AND l.job_id=j.id AND l.event IN('reserve','release');
   IF amount>remaining THEN RAISE EXCEPTION 'USAGE_LIMIT';END IF;
  END LOOP;
  IF p_usage->'units'<>'{}'::jsonb THEN
   INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units,cost_usd,cost_kind,provider,metadata) VALUES(j.workspace_id,j.id,p_operation,'consume',p_usage->'units',(p_usage->>'costUsd')::numeric,p_usage->>'costKind',a.provider,p_usage-'units'-'provider'-'operationId'-'costUsd'-'costKind');
   INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units) VALUES(j.workspace_id,j.id,p_operation,'release',p_usage->'units');
  END IF;
 END IF;
 SELECT NOT EXISTS(SELECT 1 FROM auth.member WHERE "organizationId"=j.workspace_id AND "userId"=j.actor_id) INTO revoked;
 UPDATE app.prospecting_attempt SET state='completed',payload=jsonb_build_object('result',p_result,'reservedUnits',a.payload->'reservedUnits','receivedAt',clock_timestamp(),'receivedWithoutMembership',revoked) WHERE workspace_id=j.workspace_id AND id=p_operation;
 IF revoked THEN
  -- Stop, preserve the technical receipt for current administrators, never publish.
  UPDATE app.prospecting_job SET state=CASE WHEN a.provider='apify' AND p_result->>'kind'='remote' THEN 'cancelling' ELSE 'failed' END,error_code='RESULT_RECEIVED_ACCESS_REVOKED',error_message='Resposta e consumo preservados após remoção de acesso; não houve publicação nem nova chamada.',revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=j.workspace_id AND id=j.id;
  UPDATE app.automation_occurrence SET state='failed',blocked_code='RESULT_RECEIVED_ACCESS_REVOKED' WHERE workspace_id=j.workspace_id AND job_id=j.id;
  UPDATE app.automation_lead_assignment SET state='uncertain' WHERE workspace_id=j.workspace_id AND job_id=j.id;
  SELECT COALESCE(jsonb_object_agg(totals.key,totals.amount),'{}') INTO rest FROM (SELECT key,GREATEST(sum(value::numeric*CASE WHEN event='release' THEN -1 ELSE 1 END),0) amount FROM app.usage_ledger l CROSS JOIN LATERAL jsonb_each_text(l.units) WHERE l.workspace_id=j.workspace_id AND l.job_id=j.id AND l.event IN('reserve','release') GROUP BY key) totals;
  INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units) VALUES(j.workspace_id,j.id,j.id||':close','release',rest) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NOT revoked;
END $$;
