CREATE TABLE app.research_case(
 workspace_id text NOT NULL,id text NOT NULL,job_id text NOT NULL,lead_id text NOT NULL,case_version text NOT NULL,
 name text NOT NULL,basis jsonb NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','completed','partial')),
 missing jsonb NOT NULL DEFAULT '[]'::jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,job_id,lead_id),UNIQUE(workspace_id,lead_id,case_version),
 FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id),
 FOREIGN KEY(workspace_id,lead_id) REFERENCES app.lead(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE app.research_source(
 workspace_id text NOT NULL,job_id text NOT NULL,id text NOT NULL,lead_id text NOT NULL,
 url text NOT NULL CHECK(length(url)<=2048),text text NOT NULL CHECK(length(text)<=12000),hash text NOT NULL,
 fetched_at timestamptz NOT NULL,source_kind text NOT NULL CHECK(source_kind IN('website','social','registry')),
 attribution text NOT NULL CHECK(attribution IN('company','uncertain')),links jsonb NOT NULL DEFAULT '[]',
 PRIMARY KEY(workspace_id,job_id,id),
 FOREIGN KEY(workspace_id,job_id,lead_id) REFERENCES app.research_case(workspace_id,job_id,lead_id) ON DELETE CASCADE
);
CREATE TABLE app.research_fact(
 workspace_id text NOT NULL,job_id text NOT NULL,id text NOT NULL,lead_id text NOT NULL,
 field text NOT NULL CHECK(field IN('email','phone','site','summary','instagram','facebook','linkedin','address','companyName')),
 value text NOT NULL CHECK(length(value) BETWEEN 1 AND 4000),evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array' AND jsonb_array_length(evidence) BETWEEN 1 AND 10),
 attribution text NOT NULL CHECK(attribution IN('company','uncertain')),applied boolean NOT NULL DEFAULT false,
 PRIMARY KEY(workspace_id,job_id,id),
 FOREIGN KEY(workspace_id,job_id,lead_id) REFERENCES app.research_case(workspace_id,job_id,lead_id) ON DELETE CASCADE
);
CREATE INDEX research_cases_contact ON app.research_case(workspace_id,lead_id,created_at DESC,job_id);
CREATE INDEX research_sources_case ON app.research_source(workspace_id,job_id,lead_id);
CREATE INDEX research_facts_case ON app.research_fact(workspace_id,job_id,lead_id);

CREATE FUNCTION app.research_lease(p_ws text,p_job text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT p_ws=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin','operator') AND EXISTS(
 SELECT 1 FROM app.prospecting_job j WHERE j.workspace_id=p_ws AND j.id=p_job AND j.kind='qualification'
 AND j.input ? 'companyResearch' AND j.input->'modules'='["deep"]'::jsonb AND NOT(j.input ? 'enrichment')
 AND j.actor_id=current_setting('app.user_id',true) AND j.lease_token=current_setting('app.research_token',true)
 AND j.fence::text=current_setting('app.research_fence',true) AND j.lease_until>clock_timestamp() AND j.state IN('running','waiting_provider'));
$$;
REVOKE ALL ON FUNCTION app.research_lease(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.research_lease(text,text) TO cadence_worker;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['research_case','research_source','research_fact'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker',t);
  EXECUTE format('GRANT SELECT ON app.%I TO cadence_app,cadence_worker',t);
  EXECUTE format('CREATE POLICY scoped_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
 END LOOP;
END $$;
GRANT INSERT ON app.research_source,app.research_fact TO cadence_worker;
GRANT UPDATE(state,missing) ON app.research_case TO cadence_worker;
CREATE POLICY leased_source ON app.research_source FOR INSERT TO cadence_worker WITH CHECK(app.research_lease(workspace_id,job_id));
CREATE POLICY leased_fact ON app.research_fact FOR INSERT TO cadence_worker WITH CHECK(app.research_lease(workspace_id,job_id));
CREATE POLICY leased_case ON app.research_case FOR UPDATE TO cadence_worker USING(app.research_lease(workspace_id,job_id)) WITH CHECK(app.research_lease(workspace_id,job_id));

CREATE FUNCTION app.initialize_research_case() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_lead text;l app.lead;
BEGIN
 IF NEW.kind<>'qualification' OR NOT(NEW.input ? 'companyResearch') THEN RETURN NEW;END IF;
 IF NEW.input->'modules'<>'["deep"]'::jsonb OR NEW.input ? 'enrichment' OR jsonb_array_length(NEW.input->'leadIds') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'RESEARCH_INVALID';END IF;
 FOR v_lead IN SELECT jsonb_array_elements_text(NEW.input->'leadIds') LOOP
  SELECT * INTO l FROM app.lead WHERE workspace_id=NEW.workspace_id AND id=v_lead AND list_id=NEW.list_id;
  IF NOT FOUND OR NEW.checkpoint->'bases'->v_lead IS DISTINCT FROM l.payload THEN RAISE EXCEPTION 'RESEARCH_SOURCE_CHANGED';END IF;
  INSERT INTO app.research_case(workspace_id,id,job_id,lead_id,case_version,name,basis)
  VALUES(NEW.workspace_id,md5(NEW.id||':'||v_lead),NEW.id,v_lead,NEW.id,l.payload->>'name',l.payload);
 END LOOP;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.initialize_research_case() FROM PUBLIC;
CREATE TRIGGER initialize_research_case AFTER INSERT ON app.prospecting_job FOR EACH ROW EXECUTE FUNCTION app.initialize_research_case();

CREATE FUNCTION app.apply_company_research(p_job text,p_facts text[],p_revision bigint) RETURNS jsonb
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
  IF NOT FOUND OR l.id IS NULL OR l.list_id<>j.list_id OR EXISTS(SELECT 1 FROM unnest(ARRAY['name','companyName','site','cnpj','address','city','state',f.field]) k WHERE coalesce(l.payload->k,'null'::jsonb) IS DISTINCT FROM coalesce(basis->k,'null'::jsonb)) THEN RAISE EXCEPTION 'RESEARCH_SOURCE_CHANGED';END IF;
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
