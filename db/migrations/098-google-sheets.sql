-- 07C.2b: Google Sheets export with the customer's own Google account (OAuth + PKCE, drive.file only).
-- Tokens live encrypted on the connection; a per-lead queue is fed in the same transaction as integration events.
ALTER TABLE app.integration_connection DROP CONSTRAINT integration_connection_kind_check,
 ADD CONSTRAINT integration_connection_kind_check CHECK(kind IN('apollo','google-sheets'));
ALTER TABLE app.integration_connection DROP CONSTRAINT integration_connection_state_check,
 ADD CONSTRAINT integration_connection_state_check CHECK(state IN('setup','ready','attention','revoked'));
ALTER TABLE app.integration_connection ADD COLUMN config jsonb,ADD COLUMN config_revision bigint NOT NULL DEFAULT 0,ADD COLUMN active boolean NOT NULL DEFAULT true,
 ADD COLUMN attention text CHECK(attention IN('schema','missing','reconnect','forbidden')),ADD COLUMN last_success_at timestamptz,ADD COLUMN token_expires_at timestamptz;
GRANT SELECT(config,config_revision,active,attention,last_success_at) ON app.integration_connection TO cadence_app;

CREATE TABLE app.connector_oauth_attempt(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,user_id text NOT NULL,kind text NOT NULL CHECK(kind IN('google-sheets')),
 state_hash text NOT NULL,session_hash text NOT NULL,envelope jsonb NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz,
 PRIMARY KEY(workspace_id,id)
);
CREATE UNIQUE INDEX connector_oauth_state ON app.connector_oauth_attempt(state_hash);
CREATE TABLE app.sheet_export(
 workspace_id text NOT NULL,connection_id text NOT NULL,lead_id text NOT NULL,
 event text NOT NULL CHECK(event IN('lead.created','lead.qualified','lead.connected')),channel text,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','exporting','done','held','failed','cancelled')),
 again boolean NOT NULL DEFAULT false,attempts integer NOT NULL DEFAULT 0,first_at timestamptz NOT NULL DEFAULT clock_timestamp(),next_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_token text,lease_until timestamptz,last_error text CHECK(length(last_error)<=300),exported_at timestamptz,
 PRIMARY KEY(workspace_id,connection_id,lead_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES app.integration_connection(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX sheet_export_due ON app.sheet_export(next_at) WHERE state='pending';
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['connector_oauth_attempt','sheet_export'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
END LOOP;END $$;
CREATE POLICY tenant_read ON app.sheet_export FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
GRANT SELECT(workspace_id,connection_id,state) ON app.sheet_export TO cadence_app;

-- OAuth attempt: bound to user, session, workspace and provider; 10 minutes; single use.
CREATE FUNCTION app.begin_connector_oauth(p_id text,p_kind text,p_state text,p_session text,p_envelope jsonb) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);v timestamptz:=clock_timestamp()+interval '10 minutes';
BEGIN
 PERFORM app.connector_actor();
 DELETE FROM app.connector_oauth_attempt WHERE workspace_id=ws AND (expires_at<clock_timestamp() OR used_at IS NOT NULL);
 INSERT INTO app.connector_oauth_attempt(workspace_id,id,user_id,kind,state_hash,session_hash,envelope,expires_at) VALUES(ws,p_id,current_setting('app.user_id',true),p_kind,p_state,p_session,p_envelope,v);
 RETURN v;
END $$;
CREATE FUNCTION app.consume_connector_oauth(p_state text,p_session text,p_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.connector_oauth_attempt;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO a FROM app.connector_oauth_attempt WHERE workspace_id=current_setting('app.workspace_id',true) AND state_hash=p_state FOR UPDATE;
 IF NOT FOUND OR a.user_id<>current_setting('app.user_id',true) OR a.session_hash<>p_session OR a.kind<>p_kind THEN RAISE EXCEPTION 'OAUTH_INVALID';END IF;
 IF a.used_at IS NOT NULL OR a.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'OAUTH_USED';END IF;
 UPDATE app.connector_oauth_attempt SET used_at=clock_timestamp(),envelope='{}'::jsonb WHERE workspace_id=a.workspace_id AND id=a.id;
 RETURN jsonb_build_object('id',a.id,'envelope',a.envelope);
END $$;
-- New tokens for the live connection (the revision seen when the attempt began) or a first connection in 'setup'.
CREATE FUNCTION app.save_oauth_connection(p_id text,p_kind text,p_name text,p_secret jsonb,p_caps text[],p_expected bigint,p_expires timestamptz) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.integration_connection;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=ws AND kind=p_kind AND state<>'revoked' FOR UPDATE;
 IF FOUND THEN
  IF r.id<>p_id OR r.revision<>p_expected THEN RAISE EXCEPTION 'CONNECTION_CONFLICT';END IF;
  UPDATE app.integration_connection SET name=p_name,secret=p_secret,token_expires_at=p_expires,verified_at=clock_timestamp(),last_error=NULL,revision=revision+1,
   state=CASE WHEN config IS NULL THEN 'setup' ELSE 'ready' END,attention=CASE WHEN attention IN('reconnect','forbidden') THEN NULL ELSE attention END
   WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
  IF r.attention IS NULL THEN UPDATE app.sheet_export SET state='pending',next_at=clock_timestamp() WHERE workspace_id=ws AND connection_id=p_id AND state='held';END IF;
 ELSE
  IF p_expected<>0 THEN RAISE EXCEPTION 'CONNECTION_CONFLICT';END IF;
  INSERT INTO app.integration_connection(workspace_id,id,kind,name,state,secret,capabilities,created_by,verified_at,token_expires_at)
   VALUES(ws,p_id,p_kind,p_name,'setup',p_secret,p_caps,current_setting('app.user_id',true),clock_timestamp(),p_expires) RETURNING * INTO r;
 END IF;
 RETURN r.revision;
END $$;
-- An admin action (create the spreadsheet, restore the header) needs the tokens in memory for that request only.
CREATE FUNCTION app.sheets_admin_secret(p_id text,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.integration_connection;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_id AND kind='google-sheets';
 IF NOT FOUND OR r.state NOT IN('setup','ready') OR r.revision<>p_revision OR r.secret IS NULL THEN RAISE EXCEPTION 'CONNECTION_CHANGED';END IF;
 RETURN r.secret;
END $$;
-- Refreshed access tokens keep the revision (same grant); a disconnect or reconnect since the read wins.
CREATE FUNCTION app.save_sheets_tokens(p_id text,p_revision bigint,p_secret jsonb,p_expires timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.connector_actor();
 UPDATE app.integration_connection SET secret=p_secret,token_expires_at=p_expires WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_id AND revision=p_revision AND state<>'revoked' AND secret IS NOT NULL;
 RETURN FOUND;
END $$;
CREATE FUNCTION app.worker_save_sheets_tokens(p_ws text,p_id text,p_revision bigint,p_secret jsonb,p_expires timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.integration_connection SET secret=p_secret,token_expires_at=p_expires WHERE workspace_id=p_ws AND id=p_id AND kind='google-sheets' AND revision=p_revision AND state<>'revoked' AND secret IS NOT NULL;
 RETURN FOUND;
END $$;
CREATE FUNCTION app.configure_sheets(p_id text,p_revision bigint,p_expected bigint,p_config jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.integration_connection;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=ws AND id=p_id AND kind='google-sheets' AND state<>'revoked' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_NOT_FOUND';END IF;
 IF r.revision<>p_revision OR r.config_revision<>p_expected THEN RAISE EXCEPTION 'CONNECTION_CONFLICT';END IF;
 UPDATE app.integration_connection SET config=p_config,config_revision=config_revision+1,state='ready',attention=NULL,active=true,last_error=NULL WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
 -- A new spreadsheet receives what was waiting; leads already exported to the old one are not copied.
 UPDATE app.sheet_export SET state='pending',attempts=0,first_at=clock_timestamp(),next_at=clock_timestamp(),last_error=NULL WHERE workspace_id=ws AND connection_id=p_id AND state IN('held','failed');
 RETURN r.config_revision;
END $$;
CREATE FUNCTION app.sheets_action(p_id text,p_expected bigint,p_action text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.integration_connection;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=ws AND id=p_id AND kind='google-sheets' AND state<>'revoked' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_NOT_FOUND';END IF;
 IF r.config_revision<>p_expected OR r.config IS NULL THEN RAISE EXCEPTION 'CONNECTION_CONFLICT';END IF;
 IF p_action='pause' THEN
  UPDATE app.integration_connection SET active=false,config_revision=config_revision+1 WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
  UPDATE app.sheet_export SET state='cancelled',lease_token=NULL WHERE workspace_id=ws AND connection_id=p_id AND state IN('pending','held');
 ELSIF p_action='activate' THEN
  UPDATE app.integration_connection SET active=true,config_revision=config_revision+1 WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
 ELSIF p_action IN('retry','repair') THEN
  -- Reconnect needs new tokens; retrying cannot clear it.
  IF r.attention='reconnect' THEN RAISE EXCEPTION 'CONNECTION_CONFLICT';END IF;
  UPDATE app.integration_connection SET attention=NULL,last_error=NULL,config_revision=config_revision+1 WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
  UPDATE app.sheet_export SET state='pending',attempts=0,first_at=clock_timestamp(),next_at=clock_timestamp(),last_error=NULL WHERE workspace_id=ws AND connection_id=p_id AND state IN('held','failed');
 ELSE RAISE EXCEPTION 'CONNECTION_INVALID';END IF;
 RETURN r.config_revision;
END $$;
-- Disconnect also drops the queue: nothing waits for a grant that no longer exists.
CREATE OR REPLACE FUNCTION app.revoke_connection(p_id text,p_expected bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.integration_connection;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=ws AND id=p_id AND state<>'revoked' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_NOT_FOUND';END IF;
 IF r.revision<>p_expected THEN RAISE EXCEPTION 'CONNECTION_CONFLICT';END IF;
 UPDATE app.integration_connection SET state='revoked',secret=NULL,revoked_at=clock_timestamp(),revision=revision+1 WHERE workspace_id=ws AND id=p_id;
 DELETE FROM app.sheet_export WHERE workspace_id=ws AND connection_id=p_id;
END $$;

CREATE FUNCTION app.enqueue_sheet_export(p_ws text,p_type text,p_lead text,p_channel text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 INSERT INTO app.sheet_export AS s(workspace_id,connection_id,lead_id,event,channel,state)
  SELECT p_ws,c.id,p_lead,p_type,p_channel,CASE WHEN c.attention IS NULL THEN 'pending' ELSE 'held' END FROM app.integration_connection c
  WHERE c.workspace_id=p_ws AND c.kind='google-sheets' AND c.state='ready' AND c.active AND c.config->'events' ? p_type
 -- One row per lead: a newer event replaces the waiting one; an export in flight runs again once it finishes.
 ON CONFLICT(workspace_id,connection_id,lead_id) DO UPDATE SET event=EXCLUDED.event,channel=EXCLUDED.channel,
  again=s.state='exporting',state=CASE WHEN s.state='exporting' THEN s.state ELSE EXCLUDED.state END,
  attempts=CASE WHEN s.state='exporting' THEN s.attempts ELSE 0 END,first_at=CASE WHEN s.state='exporting' THEN s.first_at ELSE clock_timestamp() END,
  next_at=CASE WHEN s.state='exporting' THEN s.next_at ELSE clock_timestamp() END,last_error=CASE WHEN s.state='exporting' THEN s.last_error END
$$;
CREATE OR REPLACE FUNCTION app.emit_integration_event(p_ws text,p_type text,p_kind text,p_entity text,p_list text,p_channel text,p_data jsonb,p_only text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v text;d jsonb:=p_data;readers boolean;
BEGIN
 IF p_kind='lead' AND p_only IS NULL THEN
  BEGIN PERFORM app.enqueue_sheet_export(p_ws,p_type,p_entity,p_channel);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'sheet export dropped: %',SQLSTATE;END;
 END IF;
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

-- The lead trigger skips work when nobody listens; an active Sheets export is now a listener too.
CREATE OR REPLACE FUNCTION app.integration_lead_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.webhook_destination WHERE workspace_id=NEW.workspace_id AND active) AND NOT app.integration_api_readers(NEW.workspace_id)
  AND NOT EXISTS(SELECT 1 FROM app.integration_connection WHERE workspace_id=NEW.workspace_id AND kind='google-sheets' AND state='ready' AND active) THEN RETURN NULL;END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM app.merge_source s JOIN app.merge_record m ON m.workspace_id=s.workspace_id AND m.id=s.merge_id WHERE s.workspace_id=NEW.workspace_id AND s.lead_id=NEW.id AND m.state='merged' AND m.id=nullif(current_setting('app.lifecycle_undo',true),'')) THEN
   PERFORM app.emit_integration_event(NEW.workspace_id,'lead.created','lead',NEW.id,NEW.list_id,NULL,app.webhook_lead_data(NEW.workspace_id,NEW.payload,NEW.list_id));END IF;
 ELSIF NEW.payload->>'qualification'='qualified' AND coalesce(OLD.payload->>'qualification','')<>'qualified' THEN
  PERFORM app.emit_integration_event(NEW.workspace_id,'lead.qualified','lead',NEW.id,NEW.list_id,NULL,app.webhook_lead_data(NEW.workspace_id,NEW.payload,NEW.list_id));
 END IF;
 RETURN NULL;
END $$;

-- Worker: one due lead at a time across workspaces; the current lead row is exported, not the event snapshot.
CREATE FUNCTION app.claim_sheet_export(p_token text) RETURNS TABLE(workspace_id text,connection_id text,lead_id text,attempts integer,first_at timestamptz,event text,channel text,
 revision bigint,config_revision bigint,secret jsonb,config jsonb,token_expires_at timestamptz,lead jsonb,list_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- A lease lost mid-export is retried; the export is an upsert by lead id, so a retry cannot duplicate the row.
 UPDATE app.sheet_export s SET state='pending',lease_token=NULL,last_error='Resultado incerto: a exportação não terminou.' WHERE s.state='exporting' AND s.lease_until<clock_timestamp();
 RETURN QUERY WITH due AS(
  SELECT s.workspace_id,s.connection_id,s.lead_id FROM app.sheet_export s JOIN app.integration_connection c ON c.workspace_id=s.workspace_id AND c.id=s.connection_id
  WHERE s.state='pending' AND s.next_at<=clock_timestamp() AND c.state='ready' AND c.active AND c.attention IS NULL AND c.secret IS NOT NULL AND c.config IS NOT NULL
  ORDER BY s.next_at LIMIT 1 FOR UPDATE OF s SKIP LOCKED),
 up AS(UPDATE app.sheet_export s SET state='exporting',again=false,attempts=s.attempts+1,lease_token=p_token,lease_until=clock_timestamp()+interval '90 seconds'
  FROM due WHERE s.workspace_id=due.workspace_id AND s.connection_id=due.connection_id AND s.lead_id=due.lead_id RETURNING s.*)
 SELECT up.workspace_id,up.connection_id,up.lead_id,up.attempts,up.first_at,up.event,up.channel,c.revision,c.config_revision,c.secret,c.config,c.token_expires_at,l.payload,li.name
 FROM up JOIN app.integration_connection c ON c.workspace_id=up.workspace_id AND c.id=up.connection_id
 LEFT JOIN app.lead l ON l.workspace_id=up.workspace_id AND l.id=up.lead_id LEFT JOIN app.list li ON li.workspace_id=l.workspace_id AND li.id=l.list_id;
END $$;
CREATE FUNCTION app.finish_sheet_export(p_ws text,p_conn text,p_lead text,p_token text,p_config_revision bigint,p_state text,p_error text,p_next timestamptz,p_attention text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s app.sheet_export;c app.integration_connection;
BEGIN
 SELECT * INTO s FROM app.sheet_export WHERE workspace_id=p_ws AND connection_id=p_conn AND lead_id=p_lead FOR UPDATE;
 IF NOT FOUND OR s.state<>'exporting' OR s.lease_token IS DISTINCT FROM p_token THEN RETURN false;END IF;
 IF p_state NOT IN('done','pending','failed','held') THEN RAISE EXCEPTION 'INTEGRATION_INVALID';END IF;
 SELECT * INTO c FROM app.integration_connection WHERE workspace_id=p_ws AND id=p_conn FOR UPDATE;
 -- Paused or reconfigured while the export was in flight: the late result is dropped.
 IF c.state<>'ready' OR NOT c.active OR c.config_revision<>p_config_revision THEN
  UPDATE app.sheet_export SET state=CASE WHEN c.active AND c.state='ready' THEN 'pending' ELSE 'cancelled' END,lease_token=NULL,lease_until=NULL,next_at=clock_timestamp()
   WHERE workspace_id=p_ws AND connection_id=p_conn AND lead_id=p_lead;
  RETURN false;
 END IF;
 UPDATE app.sheet_export SET state=CASE WHEN p_state='done' AND s.again THEN 'pending' ELSE p_state END,again=false,last_error=left(p_error,300),
  next_at=coalesce(p_next,clock_timestamp()),lease_token=NULL,lease_until=NULL,attempts=CASE WHEN p_state='done' THEN 0 ELSE s.attempts END,
  exported_at=CASE WHEN p_state='done' THEN clock_timestamp() ELSE s.exported_at END WHERE workspace_id=p_ws AND connection_id=p_conn AND lead_id=p_lead;
 IF p_state='done' THEN UPDATE app.integration_connection SET last_success_at=clock_timestamp(),last_error=NULL WHERE workspace_id=p_ws AND id=p_conn;
 ELSE
  UPDATE app.integration_connection SET last_error=left(p_error,300),attention=coalesce(p_attention,attention) WHERE workspace_id=p_ws AND id=p_conn;
  -- Once the sheet needs a person, the rest of the queue waits instead of failing lead by lead.
  IF p_attention IS NOT NULL THEN UPDATE app.sheet_export SET state='held' WHERE workspace_id=p_ws AND connection_id=p_conn AND state='pending';END IF;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.begin_connector_oauth(text,text,text,text,jsonb),app.consume_connector_oauth(text,text,text),app.save_oauth_connection(text,text,text,jsonb,text[],bigint,timestamptz),
 app.sheets_admin_secret(text,bigint),app.save_sheets_tokens(text,bigint,jsonb,timestamptz),app.worker_save_sheets_tokens(text,text,bigint,jsonb,timestamptz),app.configure_sheets(text,bigint,bigint,jsonb),app.sheets_action(text,bigint,text),
 app.enqueue_sheet_export(text,text,text,text),app.claim_sheet_export(text),app.finish_sheet_export(text,text,text,text,bigint,text,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.begin_connector_oauth(text,text,text,text,jsonb),app.consume_connector_oauth(text,text,text),app.save_oauth_connection(text,text,text,jsonb,text[],bigint,timestamptz),
 app.sheets_admin_secret(text,bigint),app.save_sheets_tokens(text,bigint,jsonb,timestamptz),app.configure_sheets(text,bigint,bigint,jsonb),app.sheets_action(text,bigint,text) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.worker_save_sheets_tokens(text,text,bigint,jsonb,timestamptz),app.claim_sheet_export(text),app.finish_sheet_export(text,text,text,text,bigint,text,text,timestamptz,text) TO cadence_worker;
