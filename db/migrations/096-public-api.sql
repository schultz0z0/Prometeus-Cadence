-- 07C.1b: scoped read-only API keys. Only a SHA-256 digest is stored; the token is shown once by the service.
CREATE TABLE app.api_credential(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
 scopes text[] NOT NULL CHECK(cardinality(scopes) BETWEEN 1 AND 2 AND scopes <@ ARRAY['leads:read','events:read']),
 prefix text NOT NULL CHECK(prefix ~ '^pcak_[A-Za-z0-9_-]{7}$'),digest text NOT NULL UNIQUE CHECK(digest ~ '^[a-f0-9]{64}$'),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),revision bigint NOT NULL DEFAULT 1,
 last_used_at timestamptz,revoked_at timestamptz,PRIMARY KEY(workspace_id,id)
);
CREATE TABLE app.api_rate(workspace_id text NOT NULL,credential_id text NOT NULL,window_start timestamptz NOT NULL,hits integer NOT NULL DEFAULT 0,
 PRIMARY KEY(workspace_id,credential_id,window_start),FOREIGN KEY(workspace_id,credential_id) REFERENCES app.api_credential(workspace_id,id) ON DELETE CASCADE);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['api_credential','api_rate'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
END LOOP;END $$;
CREATE POLICY tenant_read ON app.api_credential FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
GRANT SELECT(workspace_id,id,name,scopes,prefix,created_by,created_at,revision,last_used_at,revoked_at) ON app.api_credential TO cadence_app;

CREATE FUNCTION app.api_key_command(p_action text,p_id text,p_expected bigint,p_name text,p_scopes text[],p_digest text,p_prefix text) RETURNS app.api_credential
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.api_credential;
BEGIN
 PERFORM app.webhook_actor();
 IF p_action='create' THEN
  IF (SELECT count(*) FROM app.api_credential WHERE workspace_id=ws AND revoked_at IS NULL)>=10 THEN RAISE EXCEPTION 'API_KEY_LIMIT';END IF;
  INSERT INTO app.api_credential(workspace_id,id,name,scopes,prefix,digest,created_by) VALUES(ws,p_id,p_name,p_scopes,p_prefix,p_digest,current_setting('app.user_id',true)) RETURNING * INTO r;RETURN r;
 END IF;
 SELECT * INTO r FROM app.api_credential WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND OR r.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'API_KEY_NOT_FOUND';END IF;
 IF r.revision<>p_expected THEN RAISE EXCEPTION 'API_KEY_CONFLICT';END IF;
 -- Rotation re-binds the key to the person rotating it; the old digest stops resolving in the same transaction.
 IF p_action='rotate' THEN UPDATE app.api_credential SET digest=p_digest,prefix=p_prefix,created_by=current_setting('app.user_id',true),revision=revision+1 WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
 ELSIF p_action='revoke' THEN UPDATE app.api_credential SET revoked_at=clock_timestamp(),revision=revision+1 WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
 ELSE RAISE EXCEPTION 'API_KEY_INVALID';END IF;
 RETURN r;
END $$;
-- Resolves a bearer digest without any session: the key must be live and its creator still an owner or admin of the workspace.
-- Scope and per-minute rate are answered here so the HTTP layer never reads another workspace's keys.
CREATE FUNCTION app.resolve_api_key(p_digest text,p_scope text) RETURNS TABLE(workspace_id text,user_id text,credential_id text,role text,allowed boolean,retry_after integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.api_credential;m_role text;win timestamptz:=date_trunc('minute',clock_timestamp());n integer;
BEGIN
 SELECT * INTO c FROM app.api_credential k WHERE k.digest=p_digest AND k.revoked_at IS NULL;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT mb.role INTO m_role FROM auth.member mb WHERE mb."organizationId"=c.workspace_id AND mb."userId"=c.created_by FOR SHARE;
 IF m_role IS NULL OR m_role NOT IN('owner','admin') THEN RETURN;END IF;
 IF NOT p_scope=ANY(c.scopes) THEN RETURN QUERY SELECT c.workspace_id,c.created_by,c.id,m_role,false,0;RETURN;END IF;
 INSERT INTO app.api_rate(workspace_id,credential_id,window_start,hits) VALUES(c.workspace_id,c.id,win,1)
  ON CONFLICT ON CONSTRAINT api_rate_pkey DO UPDATE SET hits=app.api_rate.hits+1 RETURNING hits INTO n;
 DELETE FROM app.api_rate a WHERE a.workspace_id=c.workspace_id AND a.credential_id=c.id AND a.window_start<win-interval '5 minutes';
 IF n>120 THEN RETURN QUERY SELECT c.workspace_id,c.created_by,c.id,m_role,true,greatest(1,ceil(extract(epoch FROM win+interval '1 minute'-clock_timestamp()))::integer);RETURN;END IF;
 UPDATE app.api_credential k SET last_used_at=clock_timestamp() WHERE k.workspace_id=c.workspace_id AND k.id=c.id AND (k.last_used_at IS NULL OR k.last_used_at<clock_timestamp()-interval '1 minute');
 RETURN QUERY SELECT c.workspace_id,c.created_by,c.id,m_role,true,0;
END $$;
-- Events are recorded when someone can consume them: an active webhook destination or a live key with events:read.
CREATE OR REPLACE FUNCTION app.emit_integration_event(p_ws text,p_type text,p_kind text,p_entity text,p_list text,p_channel text,p_data jsonb,p_only text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v text;d jsonb:=p_data;readers boolean;
BEGIN
 readers:=p_only IS NULL AND p_type<>'webhook.test' AND EXISTS(SELECT 1 FROM app.api_credential k WHERE k.workspace_id=p_ws AND k.revoked_at IS NULL AND 'events:read'=ANY(k.scopes));
 IF NOT readers AND NOT EXISTS(SELECT 1 FROM app.webhook_destination w WHERE w.workspace_id=p_ws AND w.active AND (p_only IS NULL OR w.id=p_only)
  AND (p_type='webhook.test' OR p_type=ANY(w.events) OR (p_type='lead.connected' AND ('lead.connected.'||lower(coalesce(p_channel,'')))=ANY(w.events)))
  AND (p_type='webhook.test' OR w.list_ids IS NULL OR p_list=ANY(w.list_ids))) THEN RETURN NULL;END IF;
 IF length(d::text)>200000 THEN d:=jsonb_build_object('lead',jsonb_build_object('id',p_entity),'list',d->'list','truncated',true);END IF;
 BEGIN
  INSERT INTO app.integration_event(workspace_id,type,entity_kind,entity_id,list_id,channel,data) VALUES(p_ws,p_type,p_kind,p_entity,p_list,p_channel,d) RETURNING id INTO v;
  INSERT INTO app.integration_delivery(workspace_id,destination_id,event_id,state)
   SELECT p_ws,w.id,v,CASE WHEN w.attention IS NULL THEN 'pending' ELSE 'held' END FROM app.webhook_destination w WHERE w.workspace_id=p_ws AND w.active AND (p_only IS NULL OR w.id=p_only)
    AND (p_type='webhook.test' OR p_type=ANY(w.events) OR (p_type='lead.connected' AND ('lead.connected.'||lower(coalesce(p_channel,'')))=ANY(w.events)))
    AND (p_type='webhook.test' OR w.list_ids IS NULL OR p_list=ANY(w.list_ids));
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'integration event dropped: %',SQLSTATE;RETURN NULL;END;
 RETURN v;
END $$;
CREATE OR REPLACE FUNCTION app.integration_lead_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.webhook_destination WHERE workspace_id=NEW.workspace_id AND active)
  AND NOT EXISTS(SELECT 1 FROM app.api_credential WHERE workspace_id=NEW.workspace_id AND revoked_at IS NULL AND 'events:read'=ANY(scopes)) THEN RETURN NULL;END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM app.merge_source s JOIN app.merge_record m ON m.workspace_id=s.workspace_id AND m.id=s.merge_id WHERE s.workspace_id=NEW.workspace_id AND s.lead_id=NEW.id AND m.state='merged' AND m.id=nullif(current_setting('app.lifecycle_undo',true),'')) THEN
   PERFORM app.emit_integration_event(NEW.workspace_id,'lead.created','lead',NEW.id,NEW.list_id,NULL,app.webhook_lead_data(NEW.workspace_id,NEW.payload,NEW.list_id));END IF;
 ELSIF NEW.payload->>'qualification'='qualified' AND coalesce(OLD.payload->>'qualification','')<>'qualified' THEN
  PERFORM app.emit_integration_event(NEW.workspace_id,'lead.qualified','lead',NEW.id,NEW.list_id,NULL,app.webhook_lead_data(NEW.workspace_id,NEW.payload,NEW.list_id));
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION app.api_key_command(text,text,bigint,text,text[],text,text),app.resolve_api_key(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.api_key_command(text,text,bigint,text,text[],text,text),app.resolve_api_key(text,text) TO cadence_app;
