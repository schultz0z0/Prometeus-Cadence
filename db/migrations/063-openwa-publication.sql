-- New immutable outbox rows carry the actual provider capabilities, including legacy cadence materialization.
CREATE FUNCTION app.freeze_openwa_send_capabilities() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.channel_connection;i app.channel_identity;caps jsonb:='{"connectable":true,"requiresServiceWindow":false,"supportsOfficialTemplates":false,"supportsText":true}';
BEGIN
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=NEW.workspace_id AND id=NEW.connection_id;
 IF c.provider<>'openwa' THEN RETURN NEW;END IF;
 SELECT * INTO i FROM app.channel_identity WHERE workspace_id=NEW.workspace_id AND id=NEW.identity_id;
 IF NEW.prepared_send->'content'->>'kind' IS DISTINCT FROM 'text' THEN RAISE EXCEPTION 'OPENWA_TEXT_REQUIRED';END IF;
 IF i.scope IS DISTINCT FROM 'openwa:'||c.id OR (NEW.prepared_send->>'purpose'='campaign' AND(i.phone IS NULL OR i.external_id !~ '^[0-9]{6,20}@(c\.us|s\.whatsapp\.net)$')) THEN RAISE EXCEPTION 'OPENWA_IDENTITY_REQUIRED';END IF;
 IF NEW.prepared_send ? 'provider' AND NEW.prepared_send->>'provider'<>'openwa' OR NEW.prepared_send ? 'capabilities' AND NEW.prepared_send->'capabilities'<>caps THEN RAISE EXCEPTION 'OPENWA_CAPABILITIES_CHANGED';END IF;
 NEW.prepared_send:=NEW.prepared_send||jsonb_build_object('provider','openwa','capabilities',caps);RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.freeze_openwa_send_capabilities() FROM PUBLIC;
CREATE TRIGGER freeze_openwa_send BEFORE INSERT ON app.message_outbox FOR EACH ROW EXECUTE FUNCTION app.freeze_openwa_send_capabilities();
