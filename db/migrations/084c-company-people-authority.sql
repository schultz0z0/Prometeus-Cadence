-- Preserve the legacy membership rule, requiring write authority for companyPeople.
-- Old extractions did not enforce the corrected ownership/current-role contract.
-- Retain their history and billing ledger, but never reuse them as applicable proof.
UPDATE app.research_person_company pc SET current_state='uncertain'
 WHERE EXISTS(SELECT 1 FROM app.research_person p WHERE p.workspace_id=pc.workspace_id AND p.case_id=pc.case_id AND p.id=pc.person_id
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.evidence) e WHERE e->>'sourceVersion'='company-people-v1'));
UPDATE app.research_person_contact pc SET attribution='unresolved'
 WHERE pc.attribution='personal' AND EXISTS(SELECT 1 FROM jsonb_array_elements(pc.evidence) e WHERE e->>'sourceVersion'='company-people-v1');
CREATE FUNCTION app.company_people_actor_revoked(p_workspace text,p_actor text,p_input jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=p_workspace AND m."userId"=p_actor
 AND (COALESCE(p_input->>'companyPeople','false')<>'true' OR m.role IN('owner','admin','operator')))
$$;
REVOKE ALL ON FUNCTION app.company_people_actor_revoked(text,text,jsonb) FROM PUBLIC,cadence_app,cadence_worker;

-- Update the existing fenced claim/cleanup functions without changing their other contracts.
DO $$
DECLARE signature text; original text; updated text;
 membership text:='EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=j.workspace_id AND m."userId"=j.actor_id)';
BEGIN
 FOREACH signature IN ARRAY ARRAY['app.claim_prospecting_job_internal(text,integer,text)','app.heartbeat_prospecting_job(text,text,bigint)','app.claim_revoked_prospecting_cleanup(text)','app.ack_revoked_prospecting_cleanup(text,text,bigint,text,boolean)'] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO original;
  IF position(membership IN original)=0 THEN RAISE EXCEPTION 'PEOPLE_AUTHORITY_MIGRATION_CONTRACT_CHANGED: %',signature; END IF;
  updated:=replace(original,'NOT '||membership,'app.company_people_actor_revoked(j.workspace_id,j.actor_id,j.input)');
  updated:=replace(updated,membership,'NOT app.company_people_actor_revoked(j.workspace_id,j.actor_id,j.input)');
  EXECUTE updated;
 END LOOP;
END $$;

-- A current worker may stop only its own revoked, fenced people operation.
-- Known remote runs are cleaned by the existing cleanup lane; unknown outcomes retain holds.
CREATE FUNCTION app.revoke_company_people_job(p_job text,p_token text,p_fence bigint,p_actor text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job app.prospecting_job; uncertain boolean; remote boolean; remaining jsonb;
BEGIN
 SELECT * INTO job FROM app.prospecting_job WHERE id=p_job AND actor_id=p_actor AND lease_token=p_token AND fence=p_fence
 AND lease_until>clock_timestamp() AND state IN('running','waiting_provider','cancelling') AND input->>'companyPeople'='true' FOR UPDATE;
 IF NOT FOUND OR NOT app.company_people_actor_revoked(job.workspace_id,job.actor_id,job.input) THEN RETURN false; END IF;
 SELECT EXISTS(SELECT 1 FROM app.prospecting_attempt a WHERE a.workspace_id=job.workspace_id AND a.job_id=job.id
 AND (a.state IN('prepared','uncertain') OR a.payload->'result'->>'kind'='uncertain')) INTO uncertain;
 SELECT EXISTS(SELECT 1 FROM (
  SELECT job.provider_run r UNION ALL SELECT a.payload->'result'->'run' FROM app.prospecting_attempt a WHERE a.workspace_id=job.workspace_id AND a.job_id=job.id AND a.provider='apify'
 ) runs WHERE r->>'runId' IS NOT NULL AND NOT COALESCE(job.checkpoint->'cleanupDone','[]'::jsonb) ? (r->>'runId')) INTO remote;
 IF NOT uncertain AND NOT remote THEN
  SELECT COALESCE(jsonb_object_agg(key,amount),'{}') INTO remaining FROM (
   SELECT key,GREATEST(sum(value::numeric*CASE WHEN event='release' THEN -1 ELSE 1 END),0) amount
   FROM app.usage_ledger l CROSS JOIN LATERAL jsonb_each_text(l.units) WHERE l.workspace_id=job.workspace_id AND l.job_id=job.id AND l.event IN('reserve','release') GROUP BY key
  ) totals;
  INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units) VALUES(job.workspace_id,job.id,job.id||':close','release',remaining) ON CONFLICT DO NOTHING;
 END IF;
 UPDATE app.prospecting_job SET state=CASE WHEN uncertain THEN 'needs_reconciliation' WHEN remote THEN 'cancelling' ELSE 'cancelled' END,
 error_code='PEOPLE_AUTHORITY_REVOKED',error_message='A permissão do criador mudou. Nenhuma nova chamada ou publicação foi autorizada.',
 lease_until=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=job.workspace_id AND id=job.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.revoke_company_people_job(text,text,bigint,text) FROM PUBLIC,cadence_app;
GRANT EXECUTE ON FUNCTION app.revoke_company_people_job(text,text,bigint,text) TO cadence_worker;
