-- Follow-up to already-applied083; preserves its checksum and the reserved084 package.
CREATE FUNCTION app.guard_research_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN PERFORM app.billing_require_execution(NEW.workspace_id);RETURN NEW;END $$;
REVOKE ALL ON FUNCTION app.guard_research_publication() FROM PUBLIC;
CREATE TRIGGER research_publication_eligibility BEFORE INSERT ON app.research_source FOR EACH ROW EXECUTE FUNCTION app.guard_research_publication();
CREATE TRIGGER research_publication_eligibility BEFORE INSERT ON app.research_fact FOR EACH ROW EXECUTE FUNCTION app.guard_research_publication();
CREATE TRIGGER research_publication_eligibility BEFORE UPDATE ON app.research_case FOR EACH ROW EXECUTE FUNCTION app.guard_research_publication();

CREATE OR REPLACE FUNCTION app.apply_company_research(p_job text,p_facts text[],p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);j app.prospecting_job;f app.research_fact;l app.lead;basis jsonb;e jsonb;src app.research_source;total integer:=0;next_payload jsonb;
BEGIN
 PERFORM app.lock_membership();IF app.current_role() NOT IN('owner','admin','operator') OR app.current_role() IS NULL OR cardinality(p_facts) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO j FROM app.prospecting_job WHERE workspace_id=ws AND id=p_job FOR UPDATE;
 IF NOT FOUND OR NOT(j.input ? 'companyResearch') OR j.state NOT IN('completed','partial') OR j.revision<>p_revision THEN RAISE EXCEPTION 'RESEARCH_REVIEW_CHANGED';END IF;
 IF (SELECT count(DISTINCT id) FROM app.research_fact WHERE workspace_id=ws AND job_id=p_job AND id=ANY(p_facts) AND attribution='company' AND NOT applied)<>cardinality(p_facts) THEN RAISE EXCEPTION 'RESEARCH_SELECTION_CHANGED';END IF;
 -- Lock each lead once before validating the full selection; no partial application on conflict.
 PERFORM 1 FROM app.lead WHERE workspace_id=ws AND id IN(SELECT lead_id FROM app.research_fact WHERE workspace_id=ws AND job_id=p_job AND id=ANY(p_facts)) ORDER BY id FOR UPDATE;
 FOR f IN SELECT * FROM app.research_fact WHERE workspace_id=ws AND job_id=p_job AND id=ANY(p_facts) ORDER BY lead_id,field,id LOOP
  SELECT * INTO l FROM app.lead WHERE workspace_id=ws AND id=f.lead_id;
  SELECT r.basis INTO basis FROM app.research_case r WHERE r.workspace_id=ws AND r.job_id=p_job AND r.lead_id=f.lead_id;
  IF NOT FOUND OR l.id IS NULL OR l.list_id<>j.list_id OR EXISTS(SELECT 1 FROM unnest(ARRAY['name','companyName','site','cnpj','address','city','state',f.field]) k WHERE coalesce(l.payload->k,'null'::jsonb) IS DISTINCT FROM coalesce(basis->k,'null'::jsonb) AND NOT EXISTS(SELECT 1 FROM app.research_fact applied_fact WHERE applied_fact.workspace_id=ws AND applied_fact.job_id=p_job AND applied_fact.lead_id=f.lead_id AND applied_fact.applied AND applied_fact.field=k AND to_jsonb(applied_fact.value)=l.payload->k)) THEN RAISE EXCEPTION 'RESEARCH_SOURCE_CHANGED';END IF;
  IF EXISTS(SELECT 1 FROM app.research_fact other WHERE other.workspace_id=ws AND other.job_id=p_job AND other.id=ANY(p_facts) AND other.lead_id=f.lead_id AND other.field=f.field AND other.id<>f.id) THEN RAISE EXCEPTION 'RESEARCH_FIELD_CONFLICT';END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(f.evidence) LOOP
   SELECT * INTO src FROM app.research_source WHERE workspace_id=ws AND job_id=p_job AND id=e->>'id' AND lead_id=f.lead_id;
   IF NOT FOUND OR src.attribution<>'company' OR src.hash<>e->>'hash' OR src.url<>e->>'url' OR length(e->>'quote')<1 OR strpos(src.text,e->>'quote')=0 THEN RAISE EXCEPTION 'RESEARCH_EVIDENCE_CHANGED';END IF;
  END LOOP;
 END LOOP;
 FOR f IN SELECT * FROM app.research_fact WHERE workspace_id=ws AND job_id=p_job AND id=ANY(p_facts) ORDER BY lead_id,field,id LOOP
  UPDATE app.lead SET payload=jsonb_set(payload,ARRAY[f.field],to_jsonb(f.value),true) WHERE workspace_id=ws AND id=f.lead_id;
  UPDATE app.research_fact SET applied=true WHERE workspace_id=ws AND job_id=p_job AND id=f.id;total:=total+1;
 END LOOP;
 UPDATE app.prospecting_job SET revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_job;
 UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=ws;
 RETURN jsonb_build_object('applied',total);
END $$;
REVOKE ALL ON FUNCTION app.apply_company_research(text,text[],bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.apply_company_research(text,text[],bigint) TO cadence_app;
