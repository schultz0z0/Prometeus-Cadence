-- 07B.1: SDR agents (versioned draft, immutable activated snapshot), private knowledge, channel bindings of active agents
-- and the dry-run simulation log. Every write goes through a function that checks the caller's role; the app only reads.
CREATE TABLE app.sdr_agent(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL DEFAULT gen_random_uuid()::text,revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','active','paused')),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 draft jsonb NOT NULL CHECK(jsonb_typeof(draft)='object' AND pg_column_size(draft)<=65536),active_revision bigint,activation_request text,
 activated_at timestamptz,activated_by text,paused_at timestamptz,paused_by text,created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(id)
);
CREATE TABLE app.sdr_agent_revision(
 workspace_id text NOT NULL,agent_id text NOT NULL,revision bigint NOT NULL,config jsonb NOT NULL,context_version integer NOT NULL,channel_ids text[] NOT NULL,
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,agent_id,revision),FOREIGN KEY(workspace_id,agent_id) REFERENCES app.sdr_agent(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE app.sdr_knowledge(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL DEFAULT gen_random_uuid()::text,revision bigint NOT NULL DEFAULT 1,
 kind text NOT NULL CHECK(kind IN('faq','note')),title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','approved','archived')),approved_at timestamptz,approved_by text,created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,id)
);
-- Only active agents hold bindings; one agent per connection.
CREATE TABLE app.sdr_channel_binding(
 workspace_id text NOT NULL,connection_id text NOT NULL,agent_id text NOT NULL,revision bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,connection_id),FOREIGN KEY(workspace_id,connection_id) REFERENCES app.channel_connection(workspace_id,id),
 FOREIGN KEY(workspace_id,agent_id,revision) REFERENCES app.sdr_agent_revision(workspace_id,agent_id,revision) ON DELETE CASCADE
);
CREATE TABLE app.sdr_simulation(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL DEFAULT gen_random_uuid()::text,user_id text NOT NULL,agent_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,id)
);
CREATE INDEX sdr_simulation_day ON app.sdr_simulation(workspace_id,created_at);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['sdr_agent','sdr_agent_revision','sdr_knowledge','sdr_channel_binding','sdr_simulation'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
 EXECUTE format('CREATE POLICY ws_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
END LOOP;END $$;
GRANT SELECT ON app.sdr_agent,app.sdr_agent_revision,app.sdr_knowledge,app.sdr_channel_binding,app.sdr_simulation TO cadence_app;

CREATE FUNCTION app.sdr_pro(p_ws text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.billing_account b WHERE b.workspace_id=p_ws AND b.plan='pro' AND b.state IN('active','pilot') AND b.period_end>clock_timestamp())
$$;
CREATE FUNCTION app.sdr_channel_ready(p_ws text,p_connection text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.channel_connection cc WHERE cc.workspace_id=p_ws AND cc.id=p_connection AND cc.state='ready' AND cc.archived_at IS NULL
  AND EXISTS(SELECT 1 FROM app.channel_sender s WHERE s.workspace_id=cc.workspace_id AND s.connection_id=cc.id AND s.ready))
$$;
-- Drafting is open to every member (context.draft); activation and approval are owner/admin.
CREATE FUNCTION app.sdr_role(p_manage boolean) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r text:=app.lock_membership();
BEGIN
 IF r IS NULL OR (p_manage AND r NOT IN('owner','admin')) THEN RAISE EXCEPTION 'SDR_ACCESS';END IF;
 RETURN r;
END $$;
CREATE FUNCTION app.sdr_save_agent(p_id text,p_expected bigint,p_name text,p_draft jsonb) RETURNS app.sdr_agent
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);a app.sdr_agent;
BEGIN
 PERFORM app.sdr_role(false);
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
-- Editing a knowledge item always sends it back to draft: only the approved text can reach an active agent.
CREATE FUNCTION app.sdr_save_knowledge(p_id text,p_expected bigint,p_kind text,p_title text,p_body text) RETURNS app.sdr_knowledge
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);k app.sdr_knowledge;
BEGIN
 PERFORM app.sdr_role(false);
 IF p_id IS NULL THEN
  IF p_expected<>0 THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
  IF (SELECT count(*) FROM app.sdr_knowledge WHERE workspace_id=ws AND state<>'archived')>=200 THEN RAISE EXCEPTION 'SDR_LIMIT';END IF;
  INSERT INTO app.sdr_knowledge(workspace_id,kind,title,body,created_by) VALUES(ws,p_kind,p_title,p_body,uid) RETURNING * INTO k;RETURN k;
 END IF;
 SELECT * INTO k FROM app.sdr_knowledge WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 IF k.revision<>p_expected THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 UPDATE app.sdr_knowledge SET kind=p_kind,title=p_title,body=p_body,state='draft',approved_at=NULL,approved_by=NULL,revision=revision+1,updated_at=clock_timestamp()
  WHERE workspace_id=ws AND id=p_id RETURNING * INTO k;
 RETURN k;
END $$;
CREATE FUNCTION app.sdr_set_knowledge_state(p_id text,p_expected bigint,p_state text) RETURNS app.sdr_knowledge
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);k app.sdr_knowledge;
BEGIN
 PERFORM app.sdr_role(p_state='approved');
 IF p_state NOT IN('draft','approved','archived') THEN RAISE EXCEPTION 'SDR_INVALID';END IF;
 SELECT * INTO k FROM app.sdr_knowledge WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 IF k.revision<>p_expected THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 UPDATE app.sdr_knowledge SET state=p_state,approved_at=CASE WHEN p_state='approved' THEN clock_timestamp() END,approved_by=CASE WHEN p_state='approved' THEN uid END,
  revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id RETURNING * INTO k;
 RETURN k;
END $$;
CREATE FUNCTION app.sdr_members() RETURNS TABLE(id text,name text,role text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.sdr_role(false);
 RETURN QUERY SELECT u.id,u.name,m.role FROM auth.member m JOIN auth."user" u ON u.id=m."userId" WHERE m."organizationId"=current_setting('app.workspace_id',true) ORDER BY u.name,u.id;
END $$;
CREATE FUNCTION app.sdr_reserve_simulation(p_agent text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);n integer;
BEGIN
 PERFORM app.sdr_role(false);
 PERFORM 1 FROM app.sdr_agent WHERE workspace_id=ws AND id=p_agent FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 SELECT count(*) INTO n FROM app.sdr_simulation WHERE workspace_id=ws AND created_at>clock_timestamp()-interval '1 day';
 IF n>=30 THEN RAISE EXCEPTION 'SDR_SIM_LIMIT';END IF;
 INSERT INTO app.sdr_simulation(workspace_id,user_id,agent_id) VALUES(ws,current_setting('app.user_id',true),p_agent);
 RETURN 29-n;
END $$;
-- The service has verified the review token and the blockers; the database re-checks what it can see under the lock.
CREATE FUNCTION app.sdr_activate(p_agent text,p_revision bigint,p_config jsonb,p_context integer,p_channels text[],p_request text) RETURNS app.sdr_agent
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);a app.sdr_agent;c text;
BEGIN
 PERFORM app.sdr_role(true);
 SELECT * INTO a FROM app.sdr_agent WHERE workspace_id=ws AND id=p_agent FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 IF a.state='active' AND a.activation_request=p_request THEN RETURN a;END IF;
 IF a.revision<>p_revision THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 IF NOT app.sdr_pro(ws) THEN RAISE EXCEPTION 'SDR_PLAN';END IF;
 IF NOT EXISTS(SELECT 1 FROM app.context_version WHERE workspace_id=ws AND version=p_context AND payload->>'approvedAt' IS NOT NULL) THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 IF cardinality(p_channels)=0 THEN RAISE EXCEPTION 'SDR_CHANNEL';END IF;
 FOREACH c IN ARRAY p_channels LOOP
  IF NOT app.sdr_channel_ready(ws,c) THEN RAISE EXCEPTION 'SDR_CHANNEL';END IF;
  IF EXISTS(SELECT 1 FROM app.sdr_channel_binding b WHERE b.workspace_id=ws AND b.connection_id=c AND b.agent_id<>p_agent) THEN RAISE EXCEPTION 'SDR_CHANNEL_TAKEN';END IF;
 END LOOP;
 INSERT INTO app.sdr_agent_revision(workspace_id,agent_id,revision,config,context_version,channel_ids,created_by) VALUES(ws,p_agent,p_revision,p_config,p_context,p_channels,uid)
  ON CONFLICT DO NOTHING;
 DELETE FROM app.sdr_channel_binding WHERE workspace_id=ws AND agent_id=p_agent;
 INSERT INTO app.sdr_channel_binding(workspace_id,connection_id,agent_id,revision) SELECT ws,x,p_agent,p_revision FROM unnest(p_channels) x;
 UPDATE app.sdr_agent SET state='active',active_revision=p_revision,activation_request=p_request,activated_at=clock_timestamp(),activated_by=uid,paused_at=NULL,paused_by=NULL,updated_at=clock_timestamp()
  WHERE workspace_id=ws AND id=p_agent RETURNING * INTO a;
 RETURN a;
END $$;
-- Pausing drops the bindings and moves the revision, so no earlier review can bring the agent back.
CREATE FUNCTION app.sdr_pause(p_agent text,p_expected bigint) RETURNS app.sdr_agent
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.sdr_agent;
BEGIN
 PERFORM app.sdr_role(true);
 SELECT * INTO a FROM app.sdr_agent WHERE workspace_id=ws AND id=p_agent FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 IF a.revision<>p_expected THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 IF a.state<>'active' THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 DELETE FROM app.sdr_channel_binding WHERE workspace_id=ws AND agent_id=p_agent;
 UPDATE app.sdr_agent SET state='paused',revision=revision+1,activation_request=NULL,paused_at=clock_timestamp(),paused_by=current_setting('app.user_id',true),updated_at=clock_timestamp()
  WHERE workspace_id=ws AND id=p_agent RETURNING * INTO a;
 RETURN a;
END $$;
-- For the conversation worker (07B.2): the published config serving a connection, only while every prerequisite still holds.
CREATE FUNCTION app.sdr_agent_for_connection(p_connection text) RETURNS TABLE(workspace_id text,agent_id text,revision bigint,config jsonb,context_version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT b.workspace_id,b.agent_id,r.revision,r.config,r.context_version FROM app.sdr_channel_binding b
  JOIN app.sdr_agent a ON a.workspace_id=b.workspace_id AND a.id=b.agent_id AND a.state='active' AND a.active_revision=b.revision
  JOIN app.sdr_agent_revision r ON r.workspace_id=b.workspace_id AND r.agent_id=b.agent_id AND r.revision=b.revision
 WHERE b.connection_id=p_connection AND app.sdr_channel_ready(b.workspace_id,b.connection_id) AND app.sdr_pro(b.workspace_id)
  AND EXISTS(SELECT 1 FROM app.context_version v WHERE v.workspace_id=b.workspace_id AND v.version=r.context_version AND v.payload->>'approvedAt' IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION app.sdr_pro(text),app.sdr_channel_ready(text,text),app.sdr_role(boolean),app.sdr_save_agent(text,bigint,text,jsonb),app.sdr_save_knowledge(text,bigint,text,text,text),
 app.sdr_set_knowledge_state(text,bigint,text),app.sdr_members(),app.sdr_reserve_simulation(text),app.sdr_activate(text,bigint,jsonb,integer,text[],text),app.sdr_pause(text,bigint),
 app.sdr_agent_for_connection(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sdr_pro(text),app.sdr_save_agent(text,bigint,text,jsonb),app.sdr_save_knowledge(text,bigint,text,text,text),app.sdr_set_knowledge_state(text,bigint,text),
 app.sdr_members(),app.sdr_reserve_simulation(text),app.sdr_activate(text,bigint,jsonb,integer,text[],text),app.sdr_pause(text,bigint) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.sdr_agent_for_connection(text) TO cadence_worker;
