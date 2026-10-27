CREATE TABLE app.enrichment_resolution(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,cnpj text NOT NULL CHECK(cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
 contract text NOT NULL,job_id text NOT NULL,lead_id text NOT NULL,people jsonb NOT NULL CHECK(jsonb_typeof(people)='array' AND jsonb_array_length(people)<=10),
 resolved_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,assessment jsonb,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,job_id,cnpj),FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id)
);
CREATE INDEX enrichment_cache_lookup ON app.enrichment_resolution(workspace_id,cnpj,contract,expires_at DESC);
ALTER TABLE app.enrichment_resolution ENABLE ROW LEVEL SECURITY;ALTER TABLE app.enrichment_resolution FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON app.enrichment_resolution FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
CREATE FUNCTION app.enrichment_lease(p_ws text,p_job text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT p_ws=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin','operator') AND EXISTS(
 SELECT 1 FROM app.prospecting_job j WHERE j.workspace_id=p_ws AND j.id=p_job AND j.kind='qualification' AND j.input->'modules'='["decisors"]'::jsonb AND j.input ? 'enrichment'
 AND j.actor_id=current_setting('app.user_id',true) AND j.lease_token=current_setting('app.enrichment_token',true) AND j.fence::text=current_setting('app.enrichment_fence',true)
 AND j.lease_until>clock_timestamp() AND j.state IN('running','waiting_provider'));
$$;
REVOKE ALL ON FUNCTION app.enrichment_lease(text,text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.enrichment_lease(text,text) TO cadence_worker;
CREATE POLICY leased_insert ON app.enrichment_resolution FOR INSERT TO cadence_worker WITH CHECK(app.enrichment_lease(workspace_id,job_id));
REVOKE ALL ON app.enrichment_resolution FROM PUBLIC,cadence_app,cadence_worker;
GRANT SELECT ON app.enrichment_resolution TO cadence_app,cadence_worker;GRANT INSERT ON app.enrichment_resolution TO cadence_worker;
CREATE FUNCTION app.charge_enrichment_resolution() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF session_user<>'cadence_worker' OR NOT app.enrichment_lease(NEW.workspace_id,NEW.job_id) THEN RAISE EXCEPTION 'STALE_JOB';END IF;
 IF NOT EXISTS(SELECT 1 FROM app.lead l JOIN app.prospecting_job j ON j.workspace_id=l.workspace_id AND j.id=NEW.job_id WHERE l.workspace_id=NEW.workspace_id AND l.id=NEW.lead_id AND l.list_id=j.list_id AND l.payload->>'qualification'='qualified' AND regexp_replace(upper(l.payload->>'cnpj'),'[^A-Z0-9]','','g')=NEW.cnpj AND j.checkpoint->'enrichment'->>'contract'=NEW.contract AND j.input->'leadIds' ? l.id) THEN RAISE EXCEPTION 'ENRICHMENT_SOURCE_CHANGED';END IF;
 IF jsonb_array_length(NEW.people)>0 THEN PERFORM app.billing_consume('enrichment:'||NEW.id,'enrichment',1,'job:'||NEW.job_id);END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.charge_enrichment_resolution() FROM PUBLIC;
CREATE TRIGGER charge_enrichment_resolution BEFORE INSERT ON app.enrichment_resolution FOR EACH ROW EXECUTE FUNCTION app.charge_enrichment_resolution();
CREATE OR REPLACE FUNCTION app.billing_guard_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE needed integer;
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') THEN RETURN NEW;END IF;
 PERFORM app.billing_require_execution(NEW.workspace_id);
 IF NEW.kind='generation' THEN PERFORM app.billing_reserve('job:'||NEW.id,CASE WHEN NEW.source='APOLLO' THEN 'imports' ELSE 'extractions' END,(NEW.input->>'limit')::integer);
 ELSIF NEW.kind='qualification' AND NEW.input ? 'enrichment' THEN
  SELECT count(DISTINCT regexp_replace(upper(l.payload->>'cnpj'),'[^A-Z0-9]','','g')) INTO needed FROM app.lead l WHERE l.workspace_id=NEW.workspace_id AND l.list_id=NEW.list_id AND NEW.input->'leadIds' ? l.id AND l.payload->>'qualification'='qualified' AND NOT EXISTS(SELECT 1 FROM app.enrichment_resolution r WHERE r.workspace_id=l.workspace_id AND r.cnpj=regexp_replace(upper(l.payload->>'cnpj'),'[^A-Z0-9]','','g') AND r.contract=NEW.checkpoint->'enrichment'->>'contract' AND r.expires_at>clock_timestamp());
  PERFORM app.billing_reserve('job:'||NEW.id,'enrichment',least(needed,(NEW.input->'enrichment'->>'maxCredits')::integer));
 END IF;RETURN NEW;
END $$;

CREATE TABLE app.enrichment_delivery(
 workspace_id text NOT NULL,job_id text NOT NULL,cache_id text NOT NULL,person_key text NOT NULL,lead_id text NOT NULL,list_id text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(workspace_id,job_id,cache_id,person_key),UNIQUE(workspace_id,lead_id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id),FOREIGN KEY(workspace_id,cache_id) REFERENCES app.enrichment_resolution(workspace_id,id),
 FOREIGN KEY(workspace_id,lead_id) REFERENCES app.lead(workspace_id,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(workspace_id,list_id) REFERENCES app.list(workspace_id,id)
);
ALTER TABLE app.enrichment_delivery ENABLE ROW LEVEL SECURITY;ALTER TABLE app.enrichment_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON app.enrichment_delivery FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
REVOKE ALL ON app.enrichment_delivery FROM PUBLIC,cadence_app,cadence_worker;
GRANT SELECT ON app.enrichment_delivery TO cadence_app,cadence_worker;
CREATE OR REPLACE FUNCTION app.billing_guard_lead() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.prospecting_job;job text:=nullif(current_setting('app.billing_job_id',true),'');unit text:='imports';hold text;
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM app.enrichment_delivery d WHERE d.workspace_id=NEW.workspace_id AND d.lead_id=NEW.id AND d.payload=NEW.payload AND d.list_id=NEW.list_id) THEN RETURN NEW;END IF;
 IF job IS NOT NULL THEN
  SELECT * INTO j FROM app.prospecting_job WHERE workspace_id=NEW.workspace_id AND id=job AND actor_id=current_setting('app.user_id',true) AND lease_token=current_setting('app.billing_job_token',true) AND fence::text=current_setting('app.billing_job_fence',true) AND lease_until>clock_timestamp() AND state IN('running','waiting_provider','cancelling') AND kind='generation';
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_JOB';END IF;
  IF j.created_at<(SELECT cutover_at FROM app.billing_account WHERE workspace_id=NEW.workspace_id) THEN RETURN NEW;END IF;
  unit:=CASE WHEN j.source='APOLLO' THEN 'imports' ELSE 'extractions' END;hold:='job:'||job;
 END IF;
 PERFORM app.billing_consume('lead:'||NEW.id,unit,1,hold);RETURN NEW;
END $$;

CREATE FUNCTION app.apply_enrichment(p_job text,p_items text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);j app.prospecting_job;i app.prospecting_item;r app.enrichment_resolution;source app.lead;person jsonb;target text;new_id text;v_person_key text;lead jsonb;v_applied integer:=0;rev bigint;
BEGIN
 PERFORM app.lock_membership();IF app.current_role() NOT IN('owner','admin','operator') OR app.current_role() IS NULL OR cardinality(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO j FROM app.prospecting_job WHERE workspace_id=ws AND id=p_job FOR UPDATE;
 IF NOT FOUND OR j.kind<>'qualification' OR NOT(j.input ? 'enrichment') OR j.state NOT IN('completed','partial') THEN RAISE EXCEPTION 'ENRICHMENT_NOT_READY';END IF;
 IF (SELECT count(DISTINCT id) FROM app.prospecting_item WHERE workspace_id=ws AND job_id=p_job AND id=ANY(p_items) AND NOT applied)<>cardinality(p_items) THEN RAISE EXCEPTION 'ENRICHMENT_SELECTION';END IF;
 target:=j.checkpoint->>'outputListId';
 FOR i IN SELECT * FROM app.prospecting_item WHERE workspace_id=ws AND job_id=p_job AND id=ANY(p_items) ORDER BY id FOR UPDATE LOOP
  SELECT * INTO r FROM app.enrichment_resolution WHERE workspace_id=ws AND id=i.payload->'enrichment'->>'cacheId';
  IF NOT FOUND OR jsonb_array_length(r.people)=0 THEN RAISE EXCEPTION 'ENRICHMENT_NO_RESULT';END IF;
  SELECT * INTO source FROM app.lead WHERE workspace_id=ws AND id=i.lead_id AND list_id=j.list_id FOR UPDATE;
  IF NOT FOUND OR source.payload->>'qualification'<>'qualified' OR regexp_replace(upper(source.payload->>'cnpj'),'[^A-Z0-9]','','g')<>r.cnpj OR EXISTS(SELECT 1 FROM unnest(ARRAY['name','companyName','cnpj','site','email','phone','city','state']) k WHERE COALESCE(source.payload->k,'null'::jsonb) IS DISTINCT FROM COALESCE(j.checkpoint->'bases'->i.lead_id->k,'null'::jsonb)) THEN RAISE EXCEPTION 'ENRICHMENT_SOURCE_CHANGED';END IF;
  IF target IS NULL THEN target:=gen_random_uuid()::text;INSERT INTO app.list(workspace_id,id,name) VALUES(ws,target,j.input->'enrichment'->>'destinationName');END IF;
  FOR person IN SELECT value FROM jsonb_array_elements(r.people) LOOP
   v_person_key:=md5(lower(person->>'name')||'|'||COALESCE(person->>'email','')||'|'||COALESCE(person->>'phone',''));
   IF EXISTS(SELECT 1 FROM app.enrichment_delivery WHERE workspace_id=ws AND job_id=p_job AND cache_id=r.id AND enrichment_delivery.person_key=v_person_key) THEN CONTINUE;END IF;
   new_id:=gen_random_uuid()::text;
   lead:=jsonb_strip_nulls(jsonb_build_object('id',new_id,'listId',target,'name',person->>'name','companyName',source.payload->>'name','email',person->>'email','phone',person->>'phone','linkedin',person->>'linkedin','source','CNPJ','qualification','pending','createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'customFields',jsonb_build_object('Cargo',person->>'role','CNPJ da empresa',r.cnpj,'Fonte do contato',person->>'sourceUrl','Qualidade do WhatsApp',CASE WHEN person->>'whatsapp'='published_link' THEN 'Link publicado; atividade não verificada' ELSE 'Não verificado' END)));
   INSERT INTO app.enrichment_delivery VALUES(ws,p_job,r.id,v_person_key,new_id,target,lead);
   INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES(ws,new_id,target,lead);v_applied:=v_applied+1;
  END LOOP;
  UPDATE app.prospecting_item SET applied=true,status='applied' WHERE workspace_id=ws AND job_id=p_job AND id=i.id;
 END LOOP;
 UPDATE app.prospecting_job SET checkpoint=checkpoint||jsonb_build_object('outputListId',target),counts=jsonb_set(counts,'{inserted}',to_jsonb(COALESCE((counts->>'inserted')::integer,0)+v_applied)),revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_job;
 UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=ws RETURNING revision INTO rev;
 RETURN jsonb_build_object('applied',v_applied,'revision',rev,'listId',target);
END $$;
REVOKE ALL ON FUNCTION app.apply_enrichment(text,text[]) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.apply_enrichment(text,text[]) TO cadence_app;
