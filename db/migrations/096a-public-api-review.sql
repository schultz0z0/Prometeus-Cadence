-- 07C.1b review fixes. 096 is applied locally (checksummed); functions are replaced here.
CREATE INDEX integration_event_feed ON app.integration_event(workspace_id,occurred_at,id);
CREATE INDEX lead_api_page ON app.lead(workspace_id,(coalesce(payload->>'createdAt','')),id);

-- A key counts as a consumer only while its creator is still owner/admin and it is in use (used or created in the last 7 days);
-- a forgotten key no longer keeps copies of every lead.
CREATE FUNCTION app.integration_api_readers(p_ws text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.api_credential k JOIN auth.member mb ON mb."organizationId"=k.workspace_id AND mb."userId"=k.created_by
  WHERE k.workspace_id=p_ws AND k.revoked_at IS NULL AND 'events:read'=ANY(k.scopes) AND mb.role IN('owner','admin')
   AND greatest(k.created_at,coalesce(k.last_used_at,k.created_at))>clock_timestamp()-interval '7 days')
$$;
CREATE OR REPLACE FUNCTION app.emit_integration_event(p_ws text,p_type text,p_kind text,p_entity text,p_list text,p_channel text,p_data jsonb,p_only text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v text;d jsonb:=p_data;readers boolean;
BEGIN
 readers:=p_only IS NULL AND p_type<>'webhook.test' AND app.integration_api_readers(p_ws);
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
 IF NOT EXISTS(SELECT 1 FROM app.webhook_destination WHERE workspace_id=NEW.workspace_id AND active) AND NOT app.integration_api_readers(NEW.workspace_id) THEN RETURN NULL;END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM app.merge_source s JOIN app.merge_record m ON m.workspace_id=s.workspace_id AND m.id=s.merge_id WHERE s.workspace_id=NEW.workspace_id AND s.lead_id=NEW.id AND m.state='merged' AND m.id=nullif(current_setting('app.lifecycle_undo',true),'')) THEN
   PERFORM app.emit_integration_event(NEW.workspace_id,'lead.created','lead',NEW.id,NEW.list_id,NULL,app.webhook_lead_data(NEW.workspace_id,NEW.payload,NEW.list_id));END IF;
 ELSIF NEW.payload->>'qualification'='qualified' AND coalesce(OLD.payload->>'qualification','')<>'qualified' THEN
  PERFORM app.emit_integration_event(NEW.workspace_id,'lead.qualified','lead',NEW.id,NEW.list_id,NULL,app.webhook_lead_data(NEW.workspace_id,NEW.payload,NEW.list_id));
 END IF;
 RETURN NULL;
END $$;
-- Every resolved key call counts toward the rate, including calls without the requested scope.
CREATE OR REPLACE FUNCTION app.resolve_api_key(p_digest text,p_scope text) RETURNS TABLE(workspace_id text,user_id text,credential_id text,role text,allowed boolean,retry_after integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.api_credential;m_role text;win timestamptz:=date_trunc('minute',clock_timestamp());n integer;
BEGIN
 SELECT * INTO c FROM app.api_credential k WHERE k.digest=p_digest AND k.revoked_at IS NULL;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT mb.role INTO m_role FROM auth.member mb WHERE mb."organizationId"=c.workspace_id AND mb."userId"=c.created_by FOR SHARE;
 IF m_role IS NULL OR m_role NOT IN('owner','admin') THEN RETURN;END IF;
 INSERT INTO app.api_rate(workspace_id,credential_id,window_start,hits) VALUES(c.workspace_id,c.id,win,1)
  ON CONFLICT ON CONSTRAINT api_rate_pkey DO UPDATE SET hits=app.api_rate.hits+1 RETURNING hits INTO n;
 DELETE FROM app.api_rate a WHERE a.workspace_id=c.workspace_id AND a.credential_id=c.id AND a.window_start<win-interval '5 minutes';
 IF n>120 THEN RETURN QUERY SELECT c.workspace_id,c.created_by,c.id,m_role,p_scope=ANY(c.scopes),greatest(1,ceil(extract(epoch FROM win+interval '1 minute'-clock_timestamp()))::integer);RETURN;END IF;
 IF NOT p_scope=ANY(c.scopes) THEN RETURN QUERY SELECT c.workspace_id,c.created_by,c.id,m_role,false,0;RETURN;END IF;
 UPDATE app.api_credential k SET last_used_at=clock_timestamp() WHERE k.workspace_id=c.workspace_id AND k.id=c.id AND (k.last_used_at IS NULL OR k.last_used_at<clock_timestamp()-interval '1 minute');
 RETURN QUERY SELECT c.workspace_id,c.created_by,c.id,m_role,true,0;
END $$;
REVOKE ALL ON FUNCTION app.integration_api_readers(text) FROM PUBLIC;
