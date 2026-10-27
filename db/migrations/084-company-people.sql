CREATE TABLE app.research_company_identity(
 workspace_id text NOT NULL,case_id text NOT NULL,job_id text NOT NULL,lead_id text NOT NULL,identity_key text NOT NULL,contract text NOT NULL,
 cnpj text,legal_name text,state text NOT NULL CHECK(state IN('resolved','conflict','missing')),evidence jsonb NOT NULL,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),cache_from text,
 PRIMARY KEY(workspace_id,case_id),UNIQUE(workspace_id,case_id,identity_key),
 FOREIGN KEY(workspace_id,case_id) REFERENCES app.research_case(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,job_id,lead_id) REFERENCES app.research_case(workspace_id,job_id,lead_id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,cache_from) REFERENCES app.research_company_identity(workspace_id,case_id),
 CHECK((state='resolved' AND cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$' AND jsonb_array_length(evidence)>0) OR (state<>'resolved' AND cnpj IS NULL))
);
CREATE INDEX company_people_private_cache ON app.research_company_identity(workspace_id,identity_key,contract,expires_at DESC);
CREATE TABLE app.research_person(
 workspace_id text NOT NULL,case_id text NOT NULL,id text NOT NULL,name text NOT NULL CHECK(length(name) BETWEEN 5 AND 200),role text NOT NULL CHECK(length(role) BETWEEN 2 AND 150),
 evidence jsonb NOT NULL CHECK(jsonb_array_length(evidence)>0),PRIMARY KEY(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES app.research_company_identity(workspace_id,case_id) ON DELETE CASCADE
);
CREATE TABLE app.research_person_company(
 workspace_id text NOT NULL,case_id text NOT NULL,person_id text NOT NULL,relationship text NOT NULL CHECK(relationship IN('partner','manager','unknown')),
 current_state text NOT NULL CHECK(current_state IN('supported','uncertain')),applied_lead_id text,applied_payload jsonb,applied_list_id text,
 PRIMARY KEY(workspace_id,case_id,person_id),FOREIGN KEY(workspace_id,case_id,person_id) REFERENCES app.research_person(workspace_id,case_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,applied_lead_id) REFERENCES app.lead(workspace_id,id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE app.research_person_contact(
 workspace_id text NOT NULL,case_id text NOT NULL,person_id text NOT NULL,kind text NOT NULL CHECK(kind IN('email','phone','linkedin')),value text NOT NULL CHECK(length(value) BETWEEN 1 AND 500),
 attribution text NOT NULL CHECK(attribution IN('personal','corporate','unresolved')),evidence jsonb NOT NULL CHECK(jsonb_array_length(evidence)>0),
 PRIMARY KEY(workspace_id,case_id,person_id,kind,value),FOREIGN KEY(workspace_id,case_id,person_id) REFERENCES app.research_person(workspace_id,case_id,id) ON DELETE CASCADE
);
CREATE FUNCTION app.company_people_lease(p_ws text,p_case text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT p_ws=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin','operator') AND EXISTS(
 SELECT 1 FROM app.research_case r JOIN app.prospecting_job j ON j.workspace_id=r.workspace_id AND j.id=r.job_id
 WHERE r.workspace_id=p_ws AND r.id=p_case AND j.input->>'companyPeople'='true' AND j.input->'modules'='["decisors"]'::jsonb AND j.input ? 'enrichment'
 AND j.actor_id=current_setting('app.user_id',true) AND j.lease_token=current_setting('app.research_token',true) AND j.fence::text=current_setting('app.research_fence',true)
 AND j.lease_until>clock_timestamp() AND j.state IN('running','waiting_provider'));
$$;
REVOKE ALL ON FUNCTION app.company_people_lease(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.company_people_lease(text,text) TO cadence_worker;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['research_company_identity','research_person','research_person_company','research_person_contact'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker',t);
  EXECUTE format('GRANT SELECT ON app.%I TO cadence_app,cadence_worker',t);EXECUTE format('GRANT INSERT ON app.%I TO cadence_worker',t);
  EXECUTE format('CREATE POLICY scoped_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
  EXECUTE format('CREATE POLICY leased_insert ON app.%I FOR INSERT TO cadence_worker WITH CHECK(app.company_people_lease(workspace_id,case_id))',t);
  EXECUTE format('CREATE TRIGGER people_publication BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_research_publication()',t);
 END LOOP;
END $$;
-- Preserve the public research mode; people investigations use the same source journal and case boundaries.
CREATE OR REPLACE FUNCTION app.research_lease(p_ws text,p_job text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT p_ws=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin','operator') AND EXISTS(
 SELECT 1 FROM app.prospecting_job j WHERE j.workspace_id=p_ws AND j.id=p_job AND j.kind='qualification'
 AND ((j.input ? 'companyResearch' AND j.input->'modules'='["deep"]'::jsonb AND NOT(j.input ? 'enrichment')) OR (j.input->>'companyPeople'='true' AND j.input->'modules'='["decisors"]'::jsonb AND j.input ? 'enrichment'))
 AND j.actor_id=current_setting('app.user_id',true) AND j.lease_token=current_setting('app.research_token',true)
 AND j.fence::text=current_setting('app.research_fence',true) AND j.lease_until>clock_timestamp() AND j.state IN('running','waiting_provider'));
$$;
CREATE FUNCTION app.initialize_people_case() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_lead text;l app.lead;
BEGIN
 IF NEW.input->>'companyPeople' IS DISTINCT FROM 'true' THEN RETURN NEW;END IF;
 IF NEW.kind<>'qualification' OR NEW.input->'modules'<>'["decisors"]'::jsonb OR NOT(NEW.input ? 'enrichment') OR NEW.input ? 'companyResearch' THEN RAISE EXCEPTION 'PEOPLE_INVALID';END IF;
 FOR v_lead IN SELECT jsonb_array_elements_text(NEW.input->'leadIds') LOOP
  SELECT * INTO l FROM app.lead WHERE workspace_id=NEW.workspace_id AND id=v_lead AND list_id=NEW.list_id;
  IF NOT FOUND OR NEW.checkpoint->'bases'->v_lead IS DISTINCT FROM l.payload THEN RAISE EXCEPTION 'RESEARCH_SOURCE_CHANGED';END IF;
  INSERT INTO app.research_case(workspace_id,id,job_id,lead_id,case_version,name,basis) VALUES(NEW.workspace_id,md5(NEW.id||':'||v_lead),NEW.id,v_lead,NEW.id,l.payload->>'name',l.payload);
 END LOOP;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.initialize_people_case() FROM PUBLIC;
CREATE TRIGGER initialize_people_case AFTER INSERT ON app.prospecting_job FOR EACH ROW EXECUTE FUNCTION app.initialize_people_case();

ALTER FUNCTION app.billing_guard_job() RENAME TO billing_guard_job_before_people;
-- A trigger function cannot be called as a regular function. Keep its existing branches verbatim.
CREATE FUNCTION app.billing_guard_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE needed integer;
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') THEN RETURN NEW;END IF;
 PERFORM app.billing_require_execution(NEW.workspace_id);
 IF NEW.kind='generation' THEN PERFORM app.billing_reserve('job:'||NEW.id,CASE WHEN NEW.source='APOLLO' THEN 'imports' ELSE 'extractions' END,(NEW.input->>'limit')::integer);
 ELSIF NEW.kind='qualification' AND NEW.input ? 'enrichment' THEN
  IF NEW.input->>'companyPeople'='true' THEN
   needed:=least(jsonb_array_length(NEW.input->'leadIds'),(NEW.input->'enrichment'->>'maxCredits')::integer);
  ELSE
   SELECT count(DISTINCT regexp_replace(upper(l.payload->>'cnpj'),'[^A-Z0-9]','','g')) INTO needed FROM app.lead l WHERE l.workspace_id=NEW.workspace_id AND l.list_id=NEW.list_id AND NEW.input->'leadIds' ? l.id AND l.payload->>'qualification'='qualified' AND NOT EXISTS(SELECT 1 FROM app.enrichment_resolution r WHERE r.workspace_id=l.workspace_id AND r.cnpj=regexp_replace(upper(l.payload->>'cnpj'),'[^A-Z0-9]','','g') AND r.contract=NEW.checkpoint->'enrichment'->>'contract' AND r.expires_at>clock_timestamp());
  END IF;
  PERFORM app.billing_reserve('job:'||NEW.id,'enrichment',least(needed,(NEW.input->'enrichment'->>'maxCredits')::integer));
 END IF;RETURN NEW;
END $$;
-- Retarget the existing trigger rather than leaving its renamed function active.
DO $$ DECLARE t record;BEGIN FOR t IN SELECT tgname FROM pg_trigger WHERE tgfoid='app.billing_guard_job_before_people()'::regprocedure AND NOT tgisinternal LOOP EXECUTE format('DROP TRIGGER %I ON app.prospecting_job',t.tgname);EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON app.prospecting_job FOR EACH ROW EXECUTE FUNCTION app.billing_guard_job()',t.tgname);END LOOP;END $$;
REVOKE ALL ON FUNCTION app.billing_guard_job(),app.billing_guard_job_before_people() FROM PUBLIC;

CREATE FUNCTION app.people_evidence_valid(p_ws text,p_job text,p_lead text,p_evidence jsonb) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(p_evidence)='array' AND jsonb_array_length(p_evidence)>0 AND NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements(p_evidence) e WHERE NOT EXISTS(SELECT 1 FROM app.research_source s WHERE s.workspace_id=p_ws AND s.job_id=p_job AND s.lead_id=p_lead AND s.id=e->>'id' AND s.hash=e->>'hash' AND s.url=e->>'url' AND length(e->>'quote')>0 AND strpos(s.text,e->>'quote')>0));
$$;
REVOKE ALL ON FUNCTION app.people_evidence_valid(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.people_evidence_valid(text,text,text,jsonb) TO cadence_app,cadence_worker;
CREATE FUNCTION app.finish_company_people(p_job text,p_lead text,p_missing jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.research_company_identity;j app.prospecting_job;basis jsonb;
BEGIN
 SELECT * INTO r FROM app.research_company_identity WHERE workspace_id=ws AND job_id=p_job AND lead_id=p_lead;
 IF NOT FOUND OR session_user<>'cadence_worker' OR NOT app.company_people_lease(ws,r.case_id) THEN RAISE EXCEPTION 'STALE_JOB';END IF;
 PERFORM app.billing_require_execution(ws);SELECT * INTO j FROM app.prospecting_job WHERE workspace_id=ws AND id=p_job FOR UPDATE;
 SELECT payload INTO basis FROM app.lead WHERE workspace_id=ws AND id=p_lead FOR UPDATE;
 IF basis IS DISTINCT FROM j.checkpoint->'bases'->p_lead OR COALESCE((SELECT version FROM app.context_version WHERE workspace_id=ws AND payload->>'approvedAt' IS NOT NULL ORDER BY version DESC LIMIT 1),0)<>COALESCE((j.checkpoint->'context'->>'version')::integer,0) THEN RAISE EXCEPTION 'RESEARCH_SOURCE_CHANGED';END IF;
 IF r.state='resolved' AND NOT app.people_evidence_valid(ws,p_job,p_lead,r.evidence) THEN RAISE EXCEPTION 'RESEARCH_EVIDENCE_CHANGED';END IF;
 IF EXISTS(SELECT 1 FROM app.research_person_contact c JOIN app.research_person_company pc USING(workspace_id,case_id,person_id) WHERE c.workspace_id=ws AND c.case_id=r.case_id AND c.kind IN('email','phone') AND c.attribution='personal' AND pc.current_state='supported') AND r.state='resolved' THEN
  PERFORM app.billing_consume('people:'||r.contract||':'||r.identity_key,'enrichment',1,'job:'||p_job);
 END IF;
 UPDATE app.research_case SET state=CASE WHEN jsonb_array_length(p_missing)>0 THEN 'partial' ELSE 'completed' END,missing=p_missing WHERE workspace_id=ws AND job_id=p_job AND lead_id=p_lead;
END $$;
REVOKE ALL ON FUNCTION app.finish_company_people(text,text,jsonb) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.finish_company_people(text,text,jsonb) TO cadence_worker;

CREATE OR REPLACE FUNCTION app.billing_guard_lead() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.prospecting_job;job text:=nullif(current_setting('app.billing_job_id',true),'');unit text:='imports';hold text;
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM app.enrichment_delivery d WHERE d.workspace_id=NEW.workspace_id AND d.lead_id=NEW.id AND d.payload=NEW.payload AND d.list_id=NEW.list_id) OR EXISTS(SELECT 1 FROM app.research_person_company pc WHERE pc.workspace_id=NEW.workspace_id AND pc.applied_lead_id=NEW.id AND pc.applied_payload=NEW.payload AND pc.applied_list_id=NEW.list_id) THEN RETURN NEW;END IF;
 IF job IS NOT NULL THEN
  SELECT * INTO j FROM app.prospecting_job WHERE workspace_id=NEW.workspace_id AND id=job AND actor_id=current_setting('app.user_id',true) AND lease_token=current_setting('app.billing_job_token',true) AND fence::text=current_setting('app.billing_job_fence',true) AND lease_until>clock_timestamp() AND state IN('running','waiting_provider','cancelling') AND kind='generation';
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_JOB';END IF;
  IF j.created_at<(SELECT cutover_at FROM app.billing_account WHERE workspace_id=NEW.workspace_id) THEN RETURN NEW;END IF;
  unit:=CASE WHEN j.source='APOLLO' THEN 'imports' ELSE 'extractions' END;hold:='job:'||job;
 END IF;
 PERFORM app.billing_consume('lead:'||NEW.id,unit,1,hold);RETURN NEW;
END $$;
CREATE FUNCTION app.apply_company_people(p_job text,p_people text[],p_revision bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);j app.prospecting_job;r record;source app.lead;identity app.research_company_identity;contact app.research_person_contact;target text;new_id text;payload jsonb;total integer:=0;
BEGIN
 PERFORM app.lock_membership();IF COALESCE(app.current_role(),'') NOT IN('owner','admin','operator') OR cardinality(p_people) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM app.billing_require_execution(ws);PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO j FROM app.prospecting_job WHERE workspace_id=ws AND id=p_job FOR UPDATE;
 IF NOT FOUND OR j.input->>'companyPeople' IS DISTINCT FROM 'true' OR j.state NOT IN('completed','partial') OR j.revision<>p_revision THEN RAISE EXCEPTION 'RESEARCH_REVIEW_CHANGED';END IF;
 IF COALESCE((SELECT version FROM app.context_version WHERE workspace_id=ws AND payload->>'approvedAt' IS NOT NULL ORDER BY version DESC LIMIT 1),0)<>COALESCE((j.checkpoint->'context'->>'version')::integer,0) THEN RAISE EXCEPTION 'RESEARCH_CONTEXT_CHANGED';END IF;
 IF (SELECT count(DISTINCT p.id) FROM app.research_person p JOIN app.research_company_identity ci USING(workspace_id,case_id) JOIN app.research_person_company pc ON pc.workspace_id=p.workspace_id AND pc.case_id=p.case_id AND pc.person_id=p.id WHERE p.workspace_id=ws AND ci.job_id=p_job AND p.id=ANY(p_people) AND pc.applied_lead_id IS NULL AND pc.current_state='supported' AND ci.state='resolved')<>cardinality(p_people) THEN RAISE EXCEPTION 'RESEARCH_SELECTION_CHANGED';END IF;
 target:=j.checkpoint->>'outputListId';
 FOR r IN SELECT p.*,ci.lead_id FROM app.research_person p JOIN app.research_company_identity ci USING(workspace_id,case_id) WHERE p.workspace_id=ws AND ci.job_id=p_job AND p.id=ANY(p_people) ORDER BY p.id LOOP
  SELECT * INTO identity FROM app.research_company_identity WHERE workspace_id=ws AND case_id=r.case_id;
  SELECT * INTO source FROM app.lead WHERE workspace_id=ws AND id=r.lead_id AND list_id=j.list_id FOR UPDATE;
  IF NOT FOUND OR source.payload IS DISTINCT FROM j.checkpoint->'bases'->r.lead_id THEN RAISE EXCEPTION 'RESEARCH_SOURCE_CHANGED';END IF;
  IF NOT app.people_evidence_valid(ws,p_job,r.lead_id,identity.evidence) OR NOT app.people_evidence_valid(ws,p_job,r.lead_id,r.evidence) THEN RAISE EXCEPTION 'RESEARCH_EVIDENCE_CHANGED';END IF;
  IF NOT EXISTS(SELECT 1 FROM app.research_person_contact c WHERE c.workspace_id=ws AND c.case_id=r.case_id AND c.person_id=r.id AND c.kind IN('email','phone') AND c.attribution='personal') THEN RAISE EXCEPTION 'PEOPLE_NO_CONTACT';END IF;
  payload:=jsonb_build_object('name',r.name,'companyName',source.payload->>'name','source','CNPJ','qualification','pending','createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'customFields',jsonb_build_object('Cargo',r.role,'CNPJ da empresa',identity.cnpj,'Fonte do contato',r.evidence->0->>'url','Qualidade do WhatsApp','Não verificado'));
  FOR contact IN SELECT * FROM app.research_person_contact WHERE workspace_id=ws AND case_id=r.case_id AND person_id=r.id AND attribution='personal' ORDER BY kind,value LOOP
   IF NOT app.people_evidence_valid(ws,p_job,r.lead_id,contact.evidence) THEN RAISE EXCEPTION 'RESEARCH_EVIDENCE_CHANGED';END IF;
   payload:=jsonb_set(payload,ARRAY[contact.kind],to_jsonb(contact.value));
  END LOOP;
  IF target IS NULL THEN target:=gen_random_uuid()::text;INSERT INTO app.list(workspace_id,id,name) VALUES(ws,target,j.input->'enrichment'->>'destinationName');END IF;
  new_id:=gen_random_uuid()::text;payload:=payload||jsonb_build_object('id',new_id,'listId',target);
  UPDATE app.research_person_company SET applied_lead_id=new_id,applied_payload=payload,applied_list_id=target WHERE workspace_id=ws AND case_id=r.case_id AND person_id=r.id;
  INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES(ws,new_id,target,payload);total:=total+1;
 END LOOP;
 UPDATE app.prospecting_job SET checkpoint=checkpoint||jsonb_build_object('outputListId',target),revision=revision+1,updated_at=clock_timestamp(),counts=jsonb_set(counts,'{inserted}',to_jsonb(COALESCE((counts->>'inserted')::integer,0)+total)) WHERE workspace_id=ws AND id=p_job;
 UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=ws;RETURN jsonb_build_object('applied',total);
END $$;
REVOKE ALL ON FUNCTION app.apply_company_people(text,text[],bigint) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.apply_company_people(text,text[],bigint) TO cadence_app;
