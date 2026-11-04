-- 07B.1 review. Writes and simulations need Pro; counts are serialized per workspace; activation snapshots the stored
-- draft (never a caller-supplied config), re-checks the policy under the lock, locks the channels and is idempotent
-- only for the same revision; the approved knowledge is snapshotted by revision and a newer approved context or a changed
-- item takes the agent out of service; approved knowledge is owner/admin's; another workspace's plan is not readable.
ALTER TABLE app.sdr_agent_revision ADD COLUMN knowledge jsonb NOT NULL DEFAULT '[]';
REVOKE EXECUTE ON FUNCTION app.sdr_pro(text) FROM cadence_app;
CREATE FUNCTION app.sdr_entitled() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.current_role() IS NOT NULL AND app.sdr_pro(current_setting('app.workspace_id',true))
$$;
CREATE FUNCTION app.sdr_guard(p_manage boolean) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r text:=app.sdr_role(p_manage);
BEGIN
 IF NOT app.sdr_pro(current_setting('app.workspace_id',true)) THEN RAISE EXCEPTION 'SDR_PLAN';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('sdr:'||current_setting('app.workspace_id',true)));
 RETURN r;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_save_agent(p_id text,p_expected bigint,p_name text,p_draft jsonb) RETURNS app.sdr_agent
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);a app.sdr_agent;
BEGIN
 PERFORM app.sdr_guard(false);
 IF p_id IS NULL THEN
  IF p_expected<>0 THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
  IF (SELECT count(*) FROM app.sdr_agent WHERE workspace_id=ws)>=20 THEN RAISE EXCEPTION 'SDR_LIMIT';END IF;
  INSERT INTO app.sdr_agent(workspace_id,name,draft,created_by) VALUES(ws,p_name,p_draft,uid) RETURNING * INTO a;RETURN a;
 END IF;
 SELECT * INTO a FROM app.sdr_agent WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 IF a.revision<>p_expected THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 UPDATE app.sdr_agent SET name=p_name,draft=p_draft,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id RETURNING * INTO a;
 RETURN a;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_save_knowledge(p_id text,p_expected bigint,p_kind text,p_title text,p_body text) RETURNS app.sdr_knowledge
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);k app.sdr_knowledge;r text:=app.sdr_guard(false);
BEGIN
 IF p_id IS NULL THEN
  IF p_expected<>0 THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
  IF (SELECT count(*) FROM app.sdr_knowledge WHERE workspace_id=ws AND state<>'archived')>=200 THEN RAISE EXCEPTION 'SDR_LIMIT';END IF;
  INSERT INTO app.sdr_knowledge(workspace_id,kind,title,body,created_by) VALUES(ws,p_kind,p_title,p_body,uid) RETURNING * INTO k;RETURN k;
 END IF;
 SELECT * INTO k FROM app.sdr_knowledge WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 IF k.state='approved' AND r NOT IN('owner','admin') THEN RAISE EXCEPTION 'SDR_ACCESS';END IF;
 IF k.revision<>p_expected THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 UPDATE app.sdr_knowledge SET kind=p_kind,title=p_title,body=p_body,state='draft',approved_at=NULL,approved_by=NULL,revision=revision+1,updated_at=clock_timestamp()
  WHERE workspace_id=ws AND id=p_id RETURNING * INTO k;
 RETURN k;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_set_knowledge_state(p_id text,p_expected bigint,p_state text) RETURNS app.sdr_knowledge
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);k app.sdr_knowledge;r text:=app.sdr_role(false);
BEGIN
 IF p_state NOT IN('draft','approved','archived') THEN RAISE EXCEPTION 'SDR_INVALID';END IF;
 SELECT * INTO k FROM app.sdr_knowledge WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 IF (p_state='approved' OR k.state='approved') AND r NOT IN('owner','admin') THEN RAISE EXCEPTION 'SDR_ACCESS';END IF;
 IF k.revision<>p_expected THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 UPDATE app.sdr_knowledge SET state=p_state,approved_at=CASE WHEN p_state='approved' THEN clock_timestamp() END,approved_by=CASE WHEN p_state='approved' THEN uid END,
  revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id RETURNING * INTO k;
 RETURN k;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_reserve_simulation(p_agent text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);n integer;
BEGIN
 PERFORM app.sdr_guard(false);
 PERFORM 1 FROM app.sdr_agent WHERE workspace_id=ws AND id=p_agent;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 SELECT count(*) INTO n FROM app.sdr_simulation WHERE workspace_id=ws AND created_at>clock_timestamp()-interval '1 day';
 IF n>=30 THEN RAISE EXCEPTION 'SDR_SIM_LIMIT';END IF;
 INSERT INTO app.sdr_simulation(workspace_id,user_id,agent_id) VALUES(ws,current_setting('app.user_id',true),p_agent);
 RETURN 29-n;
END $$;
DROP FUNCTION app.sdr_activate(text,bigint,jsonb,integer,text[],text);
-- Snapshots the stored draft; the service verified the review token, and the hard policy is re-checked here.
CREATE FUNCTION app.sdr_activate(p_agent text,p_revision bigint,p_context integer,p_request text) RETURNS app.sdr_agent
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);a app.sdr_agent;c text;chs text[];kids text[];kn jsonb;
BEGIN
 PERFORM app.sdr_guard(true);
 SELECT * INTO a FROM app.sdr_agent WHERE workspace_id=ws AND id=p_agent FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 IF a.state='active' AND a.activation_request=p_request AND a.active_revision=p_revision THEN RETURN a;END IF;
 IF a.revision<>p_revision THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 IF p_context IS DISTINCT FROM (SELECT max(version) FROM app.context_version WHERE workspace_id=ws AND payload->>'approvedAt' IS NOT NULL) THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 chs:=ARRAY(SELECT jsonb_array_elements_text(coalesce(a.draft->'channelIds','[]')));
 kids:=ARRAY(SELECT jsonb_array_elements_text(coalesce(a.draft->'knowledgeIds','[]')));
 IF coalesce(a.draft->>'approvalMode','')<>'all' OR coalesce(a.draft->>'followupEnabled','true')<>'false' OR length(trim(coalesce(a.draft->>'instructions','')))=0
  OR NOT EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=ws AND m."userId"=a.draft#>>'{handoff,memberId}')
  OR (SELECT count(*) FROM app.sdr_knowledge WHERE workspace_id=ws AND id=ANY(kids) AND state='approved')<>cardinality(kids)
  OR (EXISTS(SELECT 1 FROM app.channel_connection WHERE workspace_id=ws AND id=ANY(chs) AND provider='openwa') AND coalesce((a.draft->>'maxRepliesPerDay')::int,999)>20)
 THEN RAISE EXCEPTION 'SDR_POLICY';END IF;
 IF cardinality(chs)=0 THEN RAISE EXCEPTION 'SDR_CHANNEL';END IF;
 PERFORM 1 FROM app.channel_connection WHERE workspace_id=ws AND id=ANY(chs) ORDER BY id FOR UPDATE;
 FOREACH c IN ARRAY chs LOOP
  IF NOT app.sdr_channel_ready(ws,c) THEN RAISE EXCEPTION 'SDR_CHANNEL';END IF;
  IF EXISTS(SELECT 1 FROM app.sdr_channel_binding b WHERE b.workspace_id=ws AND b.connection_id=c AND b.agent_id<>p_agent) THEN RAISE EXCEPTION 'SDR_CHANNEL_TAKEN';END IF;
 END LOOP;
 kn:=coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'revision',revision) ORDER BY id) FROM app.sdr_knowledge WHERE workspace_id=ws AND id=ANY(kids)),'[]');
 INSERT INTO app.sdr_agent_revision(workspace_id,agent_id,revision,config,context_version,channel_ids,knowledge,created_by) VALUES(ws,p_agent,p_revision,a.draft,p_context,chs,kn,uid)
  ON CONFLICT(workspace_id,agent_id,revision) DO UPDATE SET config=EXCLUDED.config,context_version=EXCLUDED.context_version,channel_ids=EXCLUDED.channel_ids,knowledge=EXCLUDED.knowledge;
 DELETE FROM app.sdr_channel_binding WHERE workspace_id=ws AND agent_id=p_agent;
 BEGIN
  INSERT INTO app.sdr_channel_binding(workspace_id,connection_id,agent_id,revision) SELECT ws,x,p_agent,p_revision FROM unnest(chs) x;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'SDR_CHANNEL_TAKEN';
 END;
 UPDATE app.sdr_agent SET state='active',active_revision=p_revision,activation_request=p_request,activated_at=clock_timestamp(),activated_by=uid,paused_at=NULL,paused_by=NULL,updated_at=clock_timestamp()
  WHERE workspace_id=ws AND id=p_agent RETURNING * INTO a;
 RETURN a;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_agent_for_connection(p_connection text) RETURNS TABLE(workspace_id text,agent_id text,revision bigint,config jsonb,context_version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT b.workspace_id,b.agent_id,r.revision,r.config,r.context_version FROM app.sdr_channel_binding b
  JOIN app.sdr_agent a ON a.workspace_id=b.workspace_id AND a.id=b.agent_id AND a.state='active' AND a.active_revision=b.revision
  JOIN app.sdr_agent_revision r ON r.workspace_id=b.workspace_id AND r.agent_id=b.agent_id AND r.revision=b.revision
 WHERE b.connection_id=p_connection AND app.sdr_channel_ready(b.workspace_id,b.connection_id) AND app.sdr_pro(b.workspace_id)
  AND r.context_version=(SELECT max(v.version) FROM app.context_version v WHERE v.workspace_id=b.workspace_id AND v.payload->>'approvedAt' IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.knowledge) s LEFT JOIN app.sdr_knowledge k ON k.workspace_id=b.workspace_id AND k.id=s->>'id'
   WHERE k.id IS NULL OR k.state<>'approved' OR k.revision<>(s->>'revision')::bigint)
$$;
REVOKE ALL ON FUNCTION app.sdr_entitled(),app.sdr_guard(boolean),app.sdr_activate(text,bigint,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sdr_entitled(),app.sdr_activate(text,bigint,integer,text) TO cadence_app;
