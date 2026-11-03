-- 07C.2a review fixes. 097 is applied locally (checksummed); functions are replaced here.
-- Expired references are deleted as soon as they expire (the key is never kept for an abandoned connect).
CREATE OR REPLACE FUNCTION app.store_connector_credential(p_id text,p_kind text,p_secret jsonb) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v timestamptz;
BEGIN
 PERFORM app.connector_actor();
 DELETE FROM app.connector_credential_ref WHERE expires_at<clock_timestamp() OR consumed_at IS NOT NULL;
 INSERT INTO app.connector_credential_ref(workspace_id,id,user_id,kind,secret) VALUES(current_setting('app.workspace_id',true),p_id,current_setting('app.user_id',true),p_kind,p_secret) RETURNING expires_at INTO v;
 RETURN v;
END $$;
-- The worker must still act for a member of the job's workspace when it reads the key.
CREATE OR REPLACE FUNCTION app.connector_secret(p_id text,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.integration_connection;
BEGIN
 IF app.current_role() IS NULL THEN RAISE EXCEPTION 'CONNECTION_CHANGED';END IF;
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_id;
 IF NOT FOUND OR r.state<>'ready' OR r.revision<>p_revision OR r.secret IS NULL THEN RAISE EXCEPTION 'CONNECTION_CHANGED';END IF;
 RETURN r.secret;
END $$;
-- The connect path takes the connector lock before reading the revision it seals the key for.
GRANT EXECUTE ON FUNCTION app.connector_actor() TO cadence_app;
