-- 06E.2 review fixes. 092 is applied locally (checksummed); functions are replaced here.
CREATE OR REPLACE FUNCTION app.merge_lead_group(p_request text,p_target text,p_sources text[],p_kind text,p_value text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text;mid text;old app.merge_record;t app.lead;s app.lead;merged jsonb;k text;moved jsonb;v_added jsonb:='{"suppressions":[],"identities":[]}';
 sup record;ident text;f text;v_enr jsonb;v_conv jsonb;v_evi jsonb;v_enrich jsonb;v_items jsonb;v_drop jsonb;v_assign jsonb;v_people jsonb;v_res jsonb;v_ids jsonb;
BEGIN
 uid:=app.lifecycle_actor();
 SELECT * INTO old FROM app.merge_record WHERE workspace_id=ws AND request_id=p_request AND target_id=p_target;
 IF FOUND THEN
  IF old.actor_id<>uid OR old.kind<>p_kind OR old.key_value<>p_value OR(SELECT array_agg(lead_id ORDER BY lead_id) FROM app.merge_source WHERE workspace_id=ws AND merge_id=old.id)<>(SELECT array_agg(x ORDER BY x) FROM unnest(p_sources) x) THEN RAISE EXCEPTION 'MERGE_REPLAY_CHANGED';END IF;
  RETURN old.id;
 END IF;
 IF p_kind NOT IN('cnpj','email','phone') OR cardinality(p_sources) NOT BETWEEN 1 AND 50 OR p_target=ANY(p_sources) THEN RAISE EXCEPTION 'MERGE_INVALID';END IF;
 -- Lock every lead before reading keys, so a concurrent edit cannot slip between check and merge.
 PERFORM 1 FROM app.lead WHERE workspace_id=ws AND id=ANY(p_sources||p_target) ORDER BY id FOR UPDATE;
 SELECT * INTO t FROM app.lead WHERE workspace_id=ws AND id=p_target;
 IF NOT FOUND OR app.lead_key(p_kind,t.payload->>app.lead_key_field(p_kind)) IS DISTINCT FROM p_value THEN RAISE EXCEPTION 'MERGE_CHANGED';END IF;
 IF(SELECT count(*) FROM app.lead WHERE workspace_id=ws AND id=ANY(p_sources) AND app.lead_key(p_kind,payload->>app.lead_key_field(p_kind))=p_value)<>cardinality(p_sources) THEN RAISE EXCEPTION 'MERGE_CHANGED';END IF;
 -- The oldest contact stays (reference rule); the client cannot choose a newer target.
 IF EXISTS(SELECT 1 FROM app.lead WHERE workspace_id=ws AND id=ANY(p_sources) AND (coalesce(app.report_timestamp(payload->>'createdAt'),'-infinity'),id)<(coalesce(app.report_timestamp(t.payload->>'createdAt'),'-infinity'),t.id)) THEN RAISE EXCEPTION 'MERGE_INVALID';END IF;
 -- Publication snapshots address recipients by the original lead id; moving a live enrollment would orphan its next steps.
 IF EXISTS(SELECT 1 FROM app.cadence_enrollment WHERE workspace_id=ws AND lead_id=ANY(p_sources) AND state IN('active','blocked')) THEN RAISE EXCEPTION 'MERGE_CONFLICT_CADENCE_ACTIVE';END IF;
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
  -- Full rows: the assignment has NOT NULL authority columns that undo must restore verbatim.
  WITH d AS(DELETE FROM app.automation_lead_assignment a WHERE a.workspace_id=ws AND a.lead_id=s.id AND EXISTS(SELECT 1 FROM app.automation_lead_assignment b WHERE b.workspace_id=ws AND b.automation_id=a.automation_id AND b.lead_id=p_target) RETURNING a.*) SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') INTO v_drop FROM d;
  WITH u AS(UPDATE app.research_person_company SET applied_lead_id=p_target WHERE workspace_id=ws AND applied_lead_id=s.id RETURNING case_id,person_id) SELECT coalesce(jsonb_agg(jsonb_build_array(case_id,person_id)),'[]') INTO v_people FROM u;
  WITH u AS(UPDATE app.enrichment_resolution SET lead_id=p_target WHERE workspace_id=ws AND lead_id=s.id RETURNING id) SELECT coalesce(jsonb_agg(id),'[]') INTO v_res FROM u;
  SELECT coalesce(jsonb_agg(jsonb_build_array(list_id,identity)),'[]') INTO v_ids FROM app.lead_identity WHERE workspace_id=ws AND lead_id=s.id;
  WITH u AS(UPDATE app.automation_lead_assignment SET lead_id=p_target WHERE workspace_id=ws AND lead_id=s.id RETURNING automation_id) SELECT coalesce(jsonb_agg(automation_id),'[]') INTO v_assign FROM u;
  moved:=jsonb_build_object('enrollments',v_enr,'conversations',v_conv,'evidence',v_evi,'enrichment',v_enrich,'items',v_items,'droppedAssignmentRows',v_drop,'assignments',v_assign,'people',v_people,'resolutions',v_res,'identities',v_ids);
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
   -- Phone identities are provider-scoped and cannot be created here; refuse rather than drop the opt-out.
   IF ident IS NULL THEN RAISE EXCEPTION 'MERGE_CONFLICT_CONSENT';END IF;
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

CREATE OR REPLACE FUNCTION app.undo_lead_merge(p_merge text,p_request text) RETURNS text
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
   OR(SELECT count(*) FROM app.automation_lead_assignment WHERE workspace_id=ws AND lead_id=m.target_id AND automation_id IN(SELECT jsonb_array_elements_text(s.moved->'assignments')))<>jsonb_array_length(s.moved->'assignments')
   OR(SELECT count(*) FROM app.enrichment_delivery d,jsonb_array_elements(s.moved->'enrichment') e WHERE d.workspace_id=ws AND d.lead_id=m.target_id AND d.job_id=e->>0 AND d.cache_id=e->>1 AND d.person_key=e->>2)<>jsonb_array_length(s.moved->'enrichment')
   OR(SELECT count(*) FROM app.prospecting_item i,jsonb_array_elements(s.moved->'items') e WHERE i.workspace_id=ws AND i.lead_id=m.target_id AND i.job_id=e->>0 AND i.id=e->>1)<>jsonb_array_length(s.moved->'items')
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
  INSERT INTO app.automation_lead_assignment SELECT (jsonb_populate_record(NULL::app.automation_lead_assignment,r)).* FROM jsonb_array_elements(coalesce(s.moved->'droppedAssignmentRows','[]')) r ON CONFLICT DO NOTHING;
  UPDATE app.research_person_company SET applied_lead_id=s.lead_id WHERE workspace_id=ws AND applied_lead_id=m.target_id AND (case_id,person_id) IN(SELECT e->>0,e->>1 FROM jsonb_array_elements(coalesce(s.moved->'people','[]')) e);
  UPDATE app.enrichment_resolution SET lead_id=s.lead_id WHERE workspace_id=ws AND lead_id=m.target_id AND id IN(SELECT jsonb_array_elements_text(coalesce(s.moved->'resolutions','[]')));
  INSERT INTO app.lead_identity(workspace_id,list_id,identity,lead_id) SELECT ws,e->>0,e->>1,s.lead_id FROM jsonb_array_elements(coalesce(s.moved->'identities','[]')) e ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM set_config('app.lifecycle_undo','',true);
 -- Suppressions added by the merge stay: a later opt-out on the same identity collides with that row and would be lost.
 UPDATE app.merge_record SET state='undone',undone_at=clock_timestamp(),undo_request=p_request,revision=revision+1 WHERE workspace_id=ws AND id=m.id;
 RETURN 'undone';
END $$;

-- Real deletions purge AI content; enrichment_resolution stays because other leads' deliveries reference it.
CREATE OR REPLACE FUNCTION app.lead_lifecycle_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM app.merge_source s JOIN app.merge_record m ON m.workspace_id=s.workspace_id AND m.id=s.merge_id WHERE s.workspace_id=OLD.workspace_id AND s.lead_id=OLD.id AND m.state='merged' AND m.id=nullif(current_setting('app.lifecycle_merge',true),'')) THEN RETURN OLD;END IF;
 INSERT INTO app.data_tombstone(workspace_id,lead_id,actor_id) VALUES(OLD.workspace_id,OLD.id,nullif(current_setting('app.user_id',true),''));
 DELETE FROM app.research_fact WHERE workspace_id=OLD.workspace_id AND lead_id=OLD.id;
 DELETE FROM app.research_source WHERE workspace_id=OLD.workspace_id AND lead_id=OLD.id;
 DELETE FROM app.identity_collision WHERE workspace_id=OLD.workspace_id AND lead_id=OLD.id;
 UPDATE app.prospecting_item SET lead_id=NULL,payload='{}',name='' WHERE workspace_id=OLD.workspace_id AND lead_id=OLD.id;
 -- Snapshots of contacts merged into this one would otherwise outlive its deletion.
 DELETE FROM app.merge_record WHERE workspace_id=OLD.workspace_id AND target_id=OLD.id;
 RETURN OLD;
END $$;
-- Cache keys are content hashes and cannot be traced to one lead; clear once per statement, not per row.
CREATE FUNCTION app.lead_lifecycle_cache() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF nullif(current_setting('app.lifecycle_merge',true),'') IS NULL THEN DELETE FROM app.prospecting_cache WHERE workspace_id IN(SELECT DISTINCT workspace_id FROM gone);END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER lead_lifecycle_cache AFTER DELETE ON app.lead REFERENCING OLD TABLE AS gone FOR EACH STATEMENT EXECUTE FUNCTION app.lead_lifecycle_cache();
REVOKE ALL ON FUNCTION app.lead_lifecycle_cache() FROM PUBLIC;

-- Snapshots of merged-away contacts end with the undo window.
CREATE OR REPLACE FUNCTION app.purge_message_text(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer:=0;c integer;r app.retention_policy;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'RETENTION_LIMIT';END IF;
 DELETE FROM app.merge_source s USING app.merge_record m WHERE m.workspace_id=s.workspace_id AND m.id=s.merge_id AND m.undo_until<clock_timestamp();
 FOR r IN SELECT * FROM app.retention_policy WHERE active LOOP
  WITH due AS(SELECT id FROM app.channel_message WHERE workspace_id=r.workspace_id AND text IS NOT NULL AND coalesce(occurred_at,created_at)<clock_timestamp()-make_interval(days=>CASE WHEN direction='outbound' THEN r.sent_days ELSE r.reply_days END) LIMIT p_limit-n FOR UPDATE SKIP LOCKED)
  UPDATE app.channel_message m SET text=NULL,text_purged_at=clock_timestamp() FROM due WHERE m.workspace_id=r.workspace_id AND m.id=due.id;
  GET DIAGNOSTICS c=ROW_COUNT;n:=n+c;
  UPDATE app.message_outbox SET prepared_send=prepared_send-'content' WHERE workspace_id=r.workspace_id AND prepared_send ? 'content' AND state IN('accepted','failed','cancelled','blocked') AND created_at<clock_timestamp()-make_interval(days=>r.sent_days);
  EXIT WHEN n>=p_limit;
 END LOOP;
 RETURN n;
END $$;
