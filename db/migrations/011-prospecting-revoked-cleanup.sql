-- Cleanup authority exposes only already-authorized run metadata, never customer rows.
CREATE FUNCTION app.claim_revoked_prospecting_cleanup(p_workspace text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job app.prospecting_job; remote jsonb; token text:=gen_random_uuid()::text; remaining jsonb; uncertain boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('cadence-prospecting-claim'));
 SELECT j.* INTO job FROM app.prospecting_job j WHERE (p_workspace IS NULL OR j.workspace_id=p_workspace) AND j.state IN('queued','running','waiting_provider','cancelling') AND (j.lease_until IS NULL OR j.lease_until<now()) AND NOT EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=j.workspace_id AND m."userId"=j.actor_id) ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT r INTO remote FROM (
  SELECT job.provider_run r UNION ALL
  SELECT a.payload->'result'->'run' FROM app.prospecting_attempt a WHERE a.workspace_id=job.workspace_id AND a.job_id=job.id AND a.provider='apify'
 ) runs WHERE r->>'runId' IS NOT NULL AND NOT COALESCE(job.checkpoint->'cleanupDone','[]'::jsonb) ? (r->>'runId') LIMIT 1;
 IF remote IS NOT NULL THEN
  UPDATE app.prospecting_job j SET state='cancelling',lease_token=token,lease_until=now()+interval '180 seconds',fence=j.fence+1 WHERE j.workspace_id=job.workspace_id AND j.id=job.id RETURNING j.fence INTO job.fence;
  RETURN jsonb_build_object('workspaceId',job.workspace_id,'jobId',job.id,'token',token,'fence',job.fence,'run',remote,'execution',job.checkpoint->'execution');
 END IF;
 SELECT EXISTS(SELECT 1 FROM app.prospecting_attempt a WHERE a.workspace_id=job.workspace_id AND a.job_id=job.id AND (a.state IN('prepared','uncertain') OR a.payload->'result'->>'kind'='uncertain')) INTO uncertain;
 IF uncertain THEN UPDATE app.prospecting_job SET state='needs_reconciliation',error_code='REVOKED_UNCERTAIN',error_message='O acesso do criador foi removido. Um administrador deve reconciliar a chamada.',revision=revision+1,updated_at=now() WHERE workspace_id=job.workspace_id AND id=job.id; RETURN NULL; END IF;
 SELECT COALESCE(jsonb_object_agg(key,amount),'{}') INTO remaining FROM (SELECT key,GREATEST(sum(value::numeric*CASE WHEN event='release' THEN -1 ELSE 1 END),0) amount FROM app.usage_ledger l CROSS JOIN LATERAL jsonb_each_text(l.units) WHERE l.workspace_id=job.workspace_id AND l.job_id=job.id AND l.event IN('reserve','release') GROUP BY key) totals;
 INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units) VALUES(job.workspace_id,job.id,job.id||':close','release',remaining) ON CONFLICT DO NOTHING;
 UPDATE app.prospecting_job SET state='cancelled',revision=revision+1,updated_at=now() WHERE workspace_id=job.workspace_id AND id=job.id;
 RETURN NULL;
END $$;
CREATE FUNCTION app.ack_revoked_prospecting_cleanup(p_job text,p_token text,p_fence bigint,p_run text,p_done boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.prospecting_job j SET checkpoint=CASE WHEN p_done THEN jsonb_set(j.checkpoint,'{cleanupDone}',COALESCE(j.checkpoint->'cleanupDone','[]')||to_jsonb(p_run),true) ELSE j.checkpoint END,lease_until=now(),updated_at=now()
 WHERE j.id=p_job AND j.lease_token=p_token AND j.fence=p_fence AND j.lease_until>now() AND NOT EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=j.workspace_id AND m."userId"=j.actor_id);
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION app.claim_revoked_prospecting_cleanup(text),app.ack_revoked_prospecting_cleanup(text,text,bigint,text,boolean) FROM PUBLIC,cadence_app;
GRANT EXECUTE ON FUNCTION app.claim_revoked_prospecting_cleanup(text),app.ack_revoked_prospecting_cleanup(text,text,bigint,text,boolean) TO cadence_worker;
