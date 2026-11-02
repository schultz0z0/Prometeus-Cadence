-- 06E.2 duplicate merge/undo, message-text retention and deletion tombstones.
-- Authority lives in SECURITY DEFINER functions scoped to app.workspace_id; tables are read-only for cadence_app.
CREATE FUNCTION app.lead_key(kind text,raw text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE v text:=btrim(coalesce(raw,''));
BEGIN
 IF kind='email' THEN v:=lower(v);RETURN CASE WHEN v ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN v END;END IF;
 IF kind='cnpj' THEN v:=upper(regexp_replace(v,'[./[:space:]-]','','g'));RETURN CASE WHEN v ~ '^[A-Z0-9]{12}[0-9]{2}$' THEN v END;END IF;
 IF kind='phone' THEN v:=regexp_replace(v,'[^0-9]','','g');IF length(v) IN(12,13) AND v LIKE '55%' THEN v:=substr(v,3);END IF;RETURN CASE WHEN length(v) IN(10,11) THEN v END;END IF;
 RETURN NULL;
END $$;

CREATE TABLE app.merge_record(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL DEFAULT gen_random_uuid()::text,request_id text NOT NULL,actor_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN('cnpj','email','phone')),key_value text NOT NULL,target_id text NOT NULL,target_hash text NOT NULL,
 added jsonb NOT NULL DEFAULT '{}',state text NOT NULL DEFAULT 'merged' CHECK(state IN('merged','undone')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),undo_until timestamptz NOT NULL,undone_at timestamptz,undo_request text,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,request_id,target_id)
);
CREATE INDEX merge_record_recent ON app.merge_record(workspace_id,created_at DESC,id);
CREATE TABLE app.merge_source(
 workspace_id text NOT NULL,merge_id text NOT NULL,lead_id text NOT NULL,list_id text NOT NULL,payload jsonb NOT NULL,moved jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(workspace_id,merge_id,lead_id),FOREIGN KEY(workspace_id,merge_id) REFERENCES app.merge_record(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE app.retention_policy(
 workspace_id text PRIMARY KEY REFERENCES auth.organization(id),active boolean NOT NULL DEFAULT false,
 sent_days integer NOT NULL DEFAULT 365 CHECK(sent_days IN(30,60,90,180,365,730,1095,1825)),
 reply_days integer NOT NULL DEFAULT 365 CHECK(reply_days IN(90,180,365,730,1095,1825)),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_by text
);
-- Minimal trail: no payload, names or contact values.
CREATE TABLE app.data_tombstone(
 workspace_id text NOT NULL REFERENCES auth.organization(id),lead_id text NOT NULL,deleted_at timestamptz NOT NULL DEFAULT clock_timestamp(),actor_id text,
 PRIMARY KEY(workspace_id,lead_id,deleted_at)
);
ALTER TABLE app.channel_message ADD COLUMN text_purged_at timestamptz;
CREATE INDEX channel_message_retention ON app.channel_message(workspace_id,direction,created_at) WHERE text IS NOT NULL;

DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['merge_record','merge_source','retention_policy','data_tombstone'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
 EXECUTE format('CREATE POLICY workspace_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
END LOOP;END $$;
GRANT SELECT ON app.merge_record,app.retention_policy TO cadence_app;

CREATE FUNCTION app.lifecycle_actor() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 IF ws IS NULL OR app.lock_membership() IS NULL THEN RAISE EXCEPTION 'LIFECYCLE_ACCESS';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lifecycle:'||ws,0));
 INSERT INTO app.workspace_meta(workspace_id) VALUES(ws) ON CONFLICT DO NOTHING;
 UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=ws;
 RETURN current_setting('app.user_id',true);
END $$;

CREATE FUNCTION app.lead_key_field(kind text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT CASE kind WHEN 'cnpj' THEN 'cnpj' WHEN 'email' THEN 'email' WHEN 'phone' THEN 'phone' END$$;

-- Full-base scan in one statement; ids ordered oldest first, which is the record that stays.
CREATE FUNCTION app.scan_duplicate_leads() RETURNS TABLE(kind text,value text,ids text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT k.kind,k.value,array_agg(k.id ORDER BY k.created_at,k.id) FROM(
  SELECT x.kind,app.lead_key(x.kind,l.payload->>app.lead_key_field(x.kind)) value,l.id,coalesce(app.report_timestamp(l.payload->>'createdAt'),'-infinity') created_at
  FROM app.lead l CROSS JOIN(VALUES('cnpj'),('email'),('phone')) x(kind) WHERE l.workspace_id=current_setting('app.workspace_id',true)
 ) k WHERE k.value IS NOT NULL GROUP BY k.kind,k.value HAVING count(*)>1 ORDER BY k.kind,k.value
$$;

CREATE FUNCTION app.merge_lead_group(p_request text,p_target text,p_sources text[],p_kind text,p_value text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text;mid text;old app.merge_record;t app.lead;s app.lead;merged jsonb;k text;moved jsonb;v_added jsonb:='{"suppressions":[],"identities":[]}';
 sup record;ident text;f text;v_enr jsonb;v_conv jsonb;v_evi jsonb;v_enrich jsonb;v_items jsonb;v_drop jsonb;v_assign jsonb;
BEGIN
 uid:=app.lifecycle_actor();
 SELECT * INTO old FROM app.merge_record WHERE workspace_id=ws AND request_id=p_request AND target_id=p_target;
 IF FOUND THEN
  IF old.actor_id<>uid OR old.kind<>p_kind OR old.key_value<>p_value OR(SELECT array_agg(lead_id ORDER BY lead_id) FROM app.merge_source WHERE workspace_id=ws AND merge_id=old.id)<>(SELECT array_agg(x ORDER BY x) FROM unnest(p_sources) x) THEN RAISE EXCEPTION 'MERGE_REPLAY_CHANGED';END IF;
  RETURN old.id;
 END IF;
 IF p_kind NOT IN('cnpj','email','phone') OR cardinality(p_sources) NOT BETWEEN 1 AND 50 OR p_target=ANY(p_sources) THEN RAISE EXCEPTION 'MERGE_INVALID';END IF;
 SELECT * INTO t FROM app.lead WHERE workspace_id=ws AND id=p_target FOR UPDATE;
 IF NOT FOUND OR app.lead_key(p_kind,t.payload->>app.lead_key_field(p_kind)) IS DISTINCT FROM p_value THEN RAISE EXCEPTION 'MERGE_CHANGED';END IF;
 IF(SELECT count(*) FROM app.lead WHERE workspace_id=ws AND id=ANY(p_sources) AND app.lead_key(p_kind,payload->>app.lead_key_field(p_kind))=p_value)<>cardinality(p_sources) THEN RAISE EXCEPTION 'MERGE_CHANGED';END IF;
 PERFORM 1 FROM app.lead WHERE workspace_id=ws AND id=ANY(p_sources) FOR UPDATE;
 IF EXISTS(SELECT 1 FROM app.cadence_enrollment WHERE workspace_id=ws AND lead_id=ANY(p_sources||p_target) GROUP BY publication_id HAVING count(*)>1) THEN RAISE EXCEPTION 'MERGE_CONFLICT_CADENCE';END IF;
 IF(SELECT count(*) FROM app.enrichment_delivery WHERE workspace_id=ws AND lead_id=ANY(p_sources||p_target))>1 THEN RAISE EXCEPTION 'MERGE_CONFLICT_ENRICHMENT';END IF;
 -- research_company_identity references research_case(job,lead) without ON UPDATE: research cannot move safely.
 IF EXISTS(SELECT 1 FROM app.research_case WHERE workspace_id=ws AND lead_id=ANY(p_sources)) THEN RAISE EXCEPTION 'MERGE_CONFLICT_RESEARCH';END IF;
 INSERT INTO app.merge_record(workspace_id,request_id,actor_id,kind,key_value,target_id,target_hash,undo_until) VALUES(ws,p_request,uid,p_kind,p_value,p_target,'',clock_timestamp()+interval '7 days') RETURNING id INTO mid;
 merged:=t.payload;
 FOR s IN SELECT * FROM app.lead WHERE workspace_id=ws AND id=ANY(p_sources) ORDER BY app.report_timestamp(payload->>'createdAt'),id LOOP
  -- Fill empty fields only; the target's own values are never overwritten.
  FOR k IN SELECT jsonb_object_keys(s.payload) LOOP
   CONTINUE WHEN k IN('id','listId','createdAt','qualification','reason','customFields');
   IF coalesce(btrim(merged->>k),'')='' AND coalesce(btrim(s.payload->>k),'')<>'' THEN merged:=jsonb_set(merged,ARRAY[k],s.payload->k);END IF;
  END LOOP;
  IF coalesce(merged->>'qualification','pending')='pending' AND coalesce(s.payload->>'qualification','pending')<>'pending' THEN merged:=merged||jsonb_strip_nulls(jsonb_build_object('qualification',s.payload->'qualification','reason',s.payload->'reason'));END IF;
  IF jsonb_typeof(s.payload->'customFields')='object' THEN merged:=jsonb_set(merged,'{customFields}',(s.payload->'customFields')||coalesce(merged->'customFields','{}'));END IF;
  WITH u AS(UPDATE app.cadence_enrollment SET lead_id=p_target WHERE workspace_id=ws AND lead_id=s.id RETURNING id) SELECT coalesce(jsonb_agg(id),'[]') INTO v_enr FROM u;
  WITH u AS(UPDATE app.channel_conversation SET lead_id=p_target WHERE workspace_id=ws AND lead_id=s.id RETURNING id) SELECT coalesce(jsonb_agg(id),'[]') INTO v_conv FROM u;
  WITH u AS(UPDATE app.lead_evidence SET lead_id=p_target WHERE workspace_id=ws AND lead_id=s.id RETURNING id) SELECT coalesce(jsonb_agg(id),'[]') INTO v_evi FROM u;
  WITH u AS(UPDATE app.enrichment_delivery SET lead_id=p_target WHERE workspace_id=ws AND lead_id=s.id RETURNING job_id,cache_id,person_key) SELECT coalesce(jsonb_agg(jsonb_build_array(job_id,cache_id,person_key)),'[]') INTO v_enrich FROM u;
  WITH u AS(UPDATE app.prospecting_item SET lead_id=p_target WHERE workspace_id=ws AND lead_id=s.id RETURNING job_id,id) SELECT coalesce(jsonb_agg(jsonb_build_array(job_id,id)),'[]') INTO v_items FROM u;
  WITH d AS(DELETE FROM app.automation_lead_assignment a WHERE a.workspace_id=ws AND a.lead_id=s.id AND EXISTS(SELECT 1 FROM app.automation_lead_assignment b WHERE b.workspace_id=ws AND b.automation_id=a.automation_id AND b.lead_id=p_target) RETURNING automation_id) SELECT coalesce(jsonb_agg(automation_id),'[]') INTO v_drop FROM d;
  WITH u AS(UPDATE app.automation_lead_assignment SET lead_id=p_target WHERE workspace_id=ws AND lead_id=s.id RETURNING automation_id) SELECT coalesce(jsonb_agg(automation_id),'[]') INTO v_assign FROM u;
  moved:=jsonb_build_object('enrollments',v_enr,'conversations',v_conv,'evidence',v_evi,'enrichment',v_enrich,'items',v_items,'droppedAssignments',v_drop,'assignments',v_assign);
  DELETE FROM app.identity_collision WHERE workspace_id=ws AND lead_id=s.id;
  INSERT INTO app.merge_source VALUES(ws,mid,s.id,s.list_id,s.payload,moved);
 END LOOP;
 -- The most restrictive consent wins: a suppressed source value also suppresses the target's differing values.
 FOR sup IN SELECT DISTINCT cs.scope,ci.scope identity_scope FROM app.lead l JOIN app.channel_identity ci ON ci.workspace_id=l.workspace_id JOIN app.contact_suppression cs ON cs.workspace_id=ci.workspace_id AND cs.identity_id=ci.id
  WHERE l.workspace_id=ws AND l.id=ANY(p_sources) AND((ci.scope='email' AND lower(ci.external_id)=app.lead_key('email',l.payload->>'email')) OR(ci.scope<>'email' AND app.lead_key('phone',ci.phone)=app.lead_key('phone',l.payload->>'phone'))) LOOP
  f:=CASE WHEN sup.identity_scope='email' THEN 'email' ELSE 'phone' END;
  CONTINUE WHEN app.lead_key(f,merged->>f) IS NULL;
  IF f='email' THEN
   SELECT id INTO ident FROM app.channel_identity WHERE workspace_id=ws AND scope='email' AND lower(external_id)=app.lead_key('email',merged->>'email');
   IF ident IS NULL THEN INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES(ws,gen_random_uuid()::text,'email',app.lead_key('email',merged->>'email')) RETURNING id INTO ident;v_added:=jsonb_set(v_added,'{identities}',v_added->'identities'||to_jsonb(ident));END IF;
  ELSE
   SELECT id INTO ident FROM app.channel_identity WHERE workspace_id=ws AND scope=sup.identity_scope AND app.lead_key('phone',phone)=app.lead_key('phone',merged->>'phone');
   CONTINUE WHEN ident IS NULL;
  END IF;
  INSERT INTO app.contact_suppression(workspace_id,identity_id,scope,reason,actor_id) VALUES(ws,ident,sup.scope,'merge:'||mid,uid) ON CONFLICT DO NOTHING;
  IF FOUND THEN v_added:=jsonb_set(v_added,'{suppressions}',v_added->'suppressions'||jsonb_build_array(jsonb_build_array(ident,sup.scope)));END IF;
 END LOOP;
 PERFORM set_config('app.lifecycle_merge',mid,true);
 DELETE FROM app.lead WHERE workspace_id=ws AND id=ANY(p_sources);
 PERFORM set_config('app.lifecycle_merge','',true);
 UPDATE app.lead SET payload=merged WHERE workspace_id=ws AND id=p_target;
 UPDATE app.merge_record SET target_hash=md5(merged::text),added=v_added WHERE workspace_id=ws AND id=mid;
 RETURN mid;
END $$;

CREATE FUNCTION app.undo_lead_merge(p_merge text,p_request text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text;m app.merge_record;s app.merge_source;v_x jsonb;
BEGIN
 uid:=app.lifecycle_actor();
 SELECT * INTO m FROM app.merge_record WHERE workspace_id=ws AND id=p_merge FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MERGE_NOT_FOUND';END IF;
 IF m.state='undone' THEN IF m.undo_request=p_request THEN RETURN m.state;END IF;RAISE EXCEPTION 'MERGE_ALREADY_UNDONE';END IF;
 IF clock_timestamp()>m.undo_until THEN RAISE EXCEPTION 'MERGE_EXPIRED';END IF;
 -- Never overwrite newer work: target and every moved row must be exactly as the merge left them.
 IF NOT EXISTS(SELECT 1 FROM app.lead WHERE workspace_id=ws AND id=m.target_id AND md5(payload::text)=m.target_hash) THEN RAISE EXCEPTION 'MERGE_CONFLICT';END IF;
 PERFORM 1 FROM app.lead WHERE workspace_id=ws AND id=m.target_id FOR UPDATE;
 FOR s IN SELECT * FROM app.merge_source WHERE workspace_id=ws AND merge_id=m.id LOOP
  IF EXISTS(SELECT 1 FROM app.lead WHERE workspace_id=ws AND id=s.lead_id) OR NOT EXISTS(SELECT 1 FROM app.list WHERE workspace_id=ws AND id=s.list_id)
   OR(SELECT count(*) FROM app.cadence_enrollment WHERE workspace_id=ws AND lead_id=m.target_id AND id IN(SELECT jsonb_array_elements_text(s.moved->'enrollments')))<>jsonb_array_length(s.moved->'enrollments')
   OR(SELECT count(*) FROM app.channel_conversation WHERE workspace_id=ws AND lead_id=m.target_id AND id IN(SELECT jsonb_array_elements_text(s.moved->'conversations')))<>jsonb_array_length(s.moved->'conversations')
   OR(SELECT count(*) FROM app.lead_evidence WHERE workspace_id=ws AND lead_id=m.target_id AND id IN(SELECT jsonb_array_elements_text(s.moved->'evidence')))<>jsonb_array_length(s.moved->'evidence')
  THEN RAISE EXCEPTION 'MERGE_CONFLICT';END IF;
 END LOOP;
 PERFORM set_config('app.lifecycle_undo',m.id,true);
 FOR s IN SELECT * FROM app.merge_source WHERE workspace_id=ws AND merge_id=m.id LOOP
  INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES(ws,s.lead_id,s.list_id,s.payload);
  UPDATE app.cadence_enrollment SET lead_id=s.lead_id WHERE workspace_id=ws AND id IN(SELECT jsonb_array_elements_text(s.moved->'enrollments'));
  UPDATE app.channel_conversation SET lead_id=s.lead_id WHERE workspace_id=ws AND id IN(SELECT jsonb_array_elements_text(s.moved->'conversations'));
  UPDATE app.lead_evidence SET lead_id=s.lead_id WHERE workspace_id=ws AND id IN(SELECT jsonb_array_elements_text(s.moved->'evidence'));
  FOR v_x IN SELECT * FROM jsonb_array_elements(s.moved->'enrichment') LOOP UPDATE app.enrichment_delivery SET lead_id=s.lead_id WHERE workspace_id=ws AND lead_id=m.target_id AND job_id=v_x->>0 AND cache_id=v_x->>1 AND person_key=v_x->>2;END LOOP;
  FOR v_x IN SELECT * FROM jsonb_array_elements(s.moved->'items') LOOP UPDATE app.prospecting_item SET lead_id=s.lead_id WHERE workspace_id=ws AND lead_id=m.target_id AND job_id=v_x->>0 AND id=v_x->>1;END LOOP;
  UPDATE app.automation_lead_assignment SET lead_id=s.lead_id WHERE workspace_id=ws AND lead_id=m.target_id AND automation_id IN(SELECT jsonb_array_elements_text(s.moved->'assignments'));
  INSERT INTO app.automation_lead_assignment(workspace_id,automation_id,lead_id) SELECT ws,a,s.lead_id FROM jsonb_array_elements_text(s.moved->'droppedAssignments') a WHERE EXISTS(SELECT 1 FROM app.automation WHERE workspace_id=ws AND id=a) ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM set_config('app.lifecycle_undo','',true);
 DELETE FROM app.contact_suppression WHERE workspace_id=ws AND reason='merge:'||m.id AND (identity_id,scope) IN(SELECT e->>0,e->>1 FROM jsonb_array_elements(m.added->'suppressions') e);
 UPDATE app.merge_record SET state='undone',undone_at=clock_timestamp(),undo_request=p_request,revision=revision+1 WHERE workspace_id=ws AND id=m.id;
 RETURN 'undone';
END $$;

-- Real deletions purge AI content tied to the contact; merge sources keep theirs because rows were moved first.
CREATE FUNCTION app.lead_lifecycle_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM app.merge_source WHERE workspace_id=OLD.workspace_id AND lead_id=OLD.id AND merge_id=nullif(current_setting('app.lifecycle_merge',true),'')) THEN RETURN OLD;END IF;
 INSERT INTO app.data_tombstone(workspace_id,lead_id,actor_id) VALUES(OLD.workspace_id,OLD.id,nullif(current_setting('app.user_id',true),''));
 DELETE FROM app.research_fact WHERE workspace_id=OLD.workspace_id AND lead_id=OLD.id;
 DELETE FROM app.research_source WHERE workspace_id=OLD.workspace_id AND lead_id=OLD.id;
 DELETE FROM app.enrichment_resolution WHERE workspace_id=OLD.workspace_id AND lead_id=OLD.id;
 DELETE FROM app.identity_collision WHERE workspace_id=OLD.workspace_id AND lead_id=OLD.id;
 UPDATE app.prospecting_item SET lead_id=NULL,payload='{}',name='' WHERE workspace_id=OLD.workspace_id AND lead_id=OLD.id;
 -- Cache keys are content hashes and cannot be traced to one lead; dropping the workspace cache only costs a re-inference.
 DELETE FROM app.prospecting_cache WHERE workspace_id=OLD.workspace_id;
 RETURN OLD;
END $$;
CREATE TRIGGER lead_lifecycle_delete BEFORE DELETE ON app.lead FOR EACH ROW EXECUTE FUNCTION app.lead_lifecycle_delete();

-- An undo re-inserts a snapshot already charged once; it is not a new import.
CREATE OR REPLACE FUNCTION app.billing_guard_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.prospecting_job;job text:=nullif(current_setting('app.billing_job_id',true),'');unit text:='imports';hold text;
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM app.merge_source s JOIN app.merge_record m ON m.workspace_id=s.workspace_id AND m.id=s.merge_id WHERE s.workspace_id=NEW.workspace_id AND s.lead_id=NEW.id AND s.payload=NEW.payload AND m.state='merged' AND m.id=nullif(current_setting('app.lifecycle_undo',true),'')) THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM app.enrichment_delivery d WHERE d.workspace_id=NEW.workspace_id AND d.lead_id=NEW.id AND d.payload=NEW.payload AND d.list_id=NEW.list_id) OR EXISTS(SELECT 1 FROM app.research_person_company pc WHERE pc.workspace_id=NEW.workspace_id AND pc.applied_lead_id=NEW.id AND pc.applied_payload=NEW.payload AND pc.applied_list_id=NEW.list_id) THEN RETURN NEW;END IF;
 IF job IS NOT NULL THEN
  SELECT * INTO j FROM app.prospecting_job WHERE workspace_id=NEW.workspace_id AND id=job AND actor_id=current_setting('app.user_id',true) AND lease_token=current_setting('app.billing_job_token',true) AND fence::text=current_setting('app.billing_job_fence',true) AND lease_until>clock_timestamp() AND state IN('running','waiting_provider','cancelling') AND kind='generation';
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_JOB';END IF;
  IF j.created_at<(SELECT cutover_at FROM app.billing_account WHERE workspace_id=NEW.workspace_id) THEN RETURN NEW;END IF;
  unit:=CASE WHEN j.source='APOLLO' THEN 'imports' ELSE 'extractions' END;hold:='job:'||job;
 END IF;
 PERFORM app.billing_consume('lead:'||NEW.id,unit,1,hold);RETURN NEW;
END $$;

CREATE FUNCTION app.save_retention_policy(expected integer,p_active boolean,p_sent integer,p_reply integer,p_confirmed boolean) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);old app.retention_policy;rev integer;
BEGIN
 -- The whole account loses text, so only the owner decides (reference: "Só o dono da conta").
 IF app.lock_membership() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'RETENTION_ACCESS';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('retention:'||ws,0));
 SELECT * INTO old FROM app.retention_policy WHERE workspace_id=ws FOR UPDATE;
 IF coalesce(old.revision,0)<>expected THEN RAISE EXCEPTION 'RETENTION_CONFLICT';END IF;
 IF p_active AND NOT p_confirmed AND(NOT coalesce(old.active,false) OR p_sent<old.sent_days OR p_reply<old.reply_days) THEN RAISE EXCEPTION 'RETENTION_CONFIRM';END IF;
 INSERT INTO app.retention_policy(workspace_id,active,sent_days,reply_days,updated_by) VALUES(ws,p_active,p_sent,p_reply,current_setting('app.user_id',true))
 ON CONFLICT(workspace_id) DO UPDATE SET active=EXCLUDED.active,sent_days=EXCLUDED.sent_days,reply_days=EXCLUDED.reply_days,revision=app.retention_policy.revision+1,updated_at=clock_timestamp(),updated_by=EXCLUDED.updated_by RETURNING revision INTO rev;
 RETURN rev;
END $$;

-- Daily batch for the worker. Each policy only touches messages of its own workspace.
CREATE FUNCTION app.purge_message_text(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer:=0;c integer;r app.retention_policy;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'RETENTION_LIMIT';END IF;
 FOR r IN SELECT * FROM app.retention_policy WHERE active LOOP
  WITH due AS(SELECT id FROM app.channel_message WHERE workspace_id=r.workspace_id AND text IS NOT NULL AND coalesce(occurred_at,created_at)<clock_timestamp()-make_interval(days=>CASE WHEN direction='outbound' THEN r.sent_days ELSE r.reply_days END) LIMIT p_limit-n FOR UPDATE SKIP LOCKED)
  UPDATE app.channel_message m SET text=NULL,text_purged_at=clock_timestamp() FROM due WHERE m.workspace_id=r.workspace_id AND m.id=due.id;
  GET DIAGNOSTICS c=ROW_COUNT;n:=n+c;
  UPDATE app.message_outbox SET prepared_send=prepared_send-'content' WHERE workspace_id=r.workspace_id AND prepared_send ? 'content' AND state IN('accepted','failed','cancelled','blocked') AND created_at<clock_timestamp()-make_interval(days=>r.sent_days);
  EXIT WHEN n>=p_limit;
 END LOOP;
 RETURN n;
END $$;

REVOKE ALL ON FUNCTION app.lead_key(text,text),app.lead_key_field(text),app.lifecycle_actor(),app.scan_duplicate_leads(),app.merge_lead_group(text,text,text[],text,text),app.undo_lead_merge(text,text),app.lead_lifecycle_delete(),app.save_retention_policy(integer,boolean,integer,integer,boolean),app.purge_message_text(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lead_key(text,text),app.lead_key_field(text),app.scan_duplicate_leads(),app.merge_lead_group(text,text,text[],text,text),app.undo_lead_merge(text,text),app.save_retention_policy(integer,boolean,integer,integer,boolean) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.purge_message_text(integer) TO cadence_worker;
