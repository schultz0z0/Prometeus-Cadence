-- 07C.2b review: results from an older grant cannot flag the new one; token saves need the export lease;
-- a re-export gets its own retry window; a deleted lead is cancelled, not counted as exported;
-- a new spreadsheet keeps pause and a pending reconnect.
DROP FUNCTION app.finish_sheet_export(text,text,text,text,bigint,text,text,timestamptz,text);
CREATE FUNCTION app.finish_sheet_export(p_ws text,p_conn text,p_lead text,p_token text,p_revision bigint,p_config_revision bigint,p_state text,p_error text,p_next timestamptz,p_attention text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s app.sheet_export;c app.integration_connection;
BEGIN
 SELECT * INTO s FROM app.sheet_export WHERE workspace_id=p_ws AND connection_id=p_conn AND lead_id=p_lead FOR UPDATE;
 IF NOT FOUND OR s.state<>'exporting' OR s.lease_token IS DISTINCT FROM p_token THEN RETURN false;END IF;
 IF p_state NOT IN('done','pending','failed','held','cancelled') THEN RAISE EXCEPTION 'INTEGRATION_INVALID';END IF;
 SELECT * INTO c FROM app.integration_connection WHERE workspace_id=p_ws AND id=p_conn FOR UPDATE;
 -- Paused, reconfigured or reconnected while the export was in flight: the late result is dropped.
 IF c.state<>'ready' OR NOT c.active OR c.config_revision<>p_config_revision OR c.revision<>p_revision THEN
  UPDATE app.sheet_export SET state=CASE WHEN c.active AND c.state='ready' THEN 'pending' ELSE 'cancelled' END,lease_token=NULL,lease_until=NULL,next_at=clock_timestamp()
   WHERE workspace_id=p_ws AND connection_id=p_conn AND lead_id=p_lead;
  RETURN false;
 END IF;
 UPDATE app.sheet_export SET state=CASE WHEN s.again THEN 'pending' ELSE p_state END,again=false,last_error=CASE WHEN s.again THEN NULL ELSE left(p_error,300) END,
  next_at=CASE WHEN s.again THEN clock_timestamp() ELSE coalesce(p_next,clock_timestamp()) END,lease_token=NULL,lease_until=NULL,
  attempts=CASE WHEN s.again OR p_state='done' THEN 0 ELSE s.attempts END,first_at=CASE WHEN s.again THEN clock_timestamp() ELSE s.first_at END,
  exported_at=CASE WHEN p_state='done' THEN clock_timestamp() ELSE s.exported_at END WHERE workspace_id=p_ws AND connection_id=p_conn AND lead_id=p_lead;
 IF p_state='done' THEN UPDATE app.integration_connection SET last_success_at=clock_timestamp(),last_error=NULL WHERE workspace_id=p_ws AND id=p_conn;
 ELSIF p_state<>'cancelled' THEN
  UPDATE app.integration_connection SET last_error=left(p_error,300),attention=coalesce(p_attention,attention) WHERE workspace_id=p_ws AND id=p_conn;
  IF p_attention IS NOT NULL THEN UPDATE app.sheet_export SET state='held' WHERE workspace_id=p_ws AND connection_id=p_conn AND state='pending';END IF;
 END IF;
 RETURN true;
END $$;
DROP FUNCTION app.worker_save_sheets_tokens(text,text,bigint,jsonb,timestamptz);
CREATE FUNCTION app.worker_save_sheets_tokens(p_ws text,p_id text,p_revision bigint,p_secret jsonb,p_expires timestamptz,p_lead text,p_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.sheet_export WHERE workspace_id=p_ws AND connection_id=p_id AND lead_id=p_lead AND state='exporting' AND lease_token=p_token) THEN RETURN false;END IF;
 UPDATE app.integration_connection SET secret=p_secret,token_expires_at=p_expires WHERE workspace_id=p_ws AND id=p_id AND kind='google-sheets' AND revision=p_revision AND state<>'revoked' AND secret IS NOT NULL;
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION app.configure_sheets(p_id text,p_revision bigint,p_expected bigint,p_config jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.integration_connection;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=ws AND id=p_id AND kind='google-sheets' AND state<>'revoked' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_NOT_FOUND';END IF;
 IF r.revision<>p_revision OR r.config_revision<>p_expected THEN RAISE EXCEPTION 'CONNECTION_CONFLICT';END IF;
 -- A new spreadsheet fixes sheet problems; a paused export stays paused and a refused grant still needs a reconnect.
 UPDATE app.integration_connection SET config=p_config,config_revision=config_revision+1,state='ready',attention=CASE WHEN attention='reconnect' THEN attention END,
  last_error=CASE WHEN attention='reconnect' THEN last_error END WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
 IF r.attention IS NULL THEN
  UPDATE app.sheet_export SET state='pending',attempts=0,first_at=clock_timestamp(),next_at=clock_timestamp(),last_error=NULL WHERE workspace_id=ws AND connection_id=p_id AND state IN('held','failed');
 END IF;
 RETURN r.config_revision;
END $$;
REVOKE ALL ON FUNCTION app.finish_sheet_export(text,text,text,text,bigint,bigint,text,text,timestamptz,text),app.worker_save_sheets_tokens(text,text,bigint,jsonb,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finish_sheet_export(text,text,text,text,bigint,bigint,text,text,timestamptz,text),app.worker_save_sheets_tokens(text,text,bigint,jsonb,timestamptz,text,text) TO cadence_worker;
