ALTER TABLE app.channel_connection ADD COLUMN archived_at timestamptz;
CREATE FUNCTION app.archive_channel_connection(p_id text,p_revision bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.channel_connection;ws text:=current_setting('app.workspace_id',true);
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHANNEL_NOT_FOUND';END IF;
 IF c.revision<>p_revision OR c.channel<>'WHATSAPP' OR c.state<>'disconnected' OR c.archived_at IS NOT NULL THEN RAISE EXCEPTION 'ARCHIVE_NOT_READY';END IF;
 IF EXISTS(SELECT 1 FROM app.openwa_connection WHERE workspace_id=ws AND connection_id=p_id AND (desired_state<>'disconnected' OR stage<>'idle' OR phase<>'disconnected')) OR EXISTS(SELECT 1 FROM app.message_outbox WHERE workspace_id=ws AND connection_id=p_id AND state IN('pending','dispatching','uncertain')) THEN RAISE EXCEPTION 'ARCHIVE_PENDING_WORK';END IF;
 UPDATE app.channel_connection SET archived_at=clock_timestamp(),revision=revision+1,credentials_verified=false,challenge_verified=false,last_error=NULL,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id;
 UPDATE app.channel_sender SET ready=false WHERE workspace_id=ws AND connection_id=p_id;
 DELETE FROM app.channel_credential WHERE workspace_id=ws AND connection_id=p_id;
 DELETE FROM app.channel_account_ownership WHERE workspace_id=ws AND connection_id=p_id;
 UPDATE app.channel_received_event SET time_lookup_state='done',lookup_token=NULL,lookup_until=NULL WHERE workspace_id=ws AND connection_id=p_id AND time_lookup_state<>'none';
END $$;
REVOKE ALL ON FUNCTION app.archive_channel_connection(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.archive_channel_connection(text,bigint) TO cadence_app;
CREATE FUNCTION app.freeze_archived_connection() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN IF OLD.archived_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'CHANNEL_ARCHIVED';END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION app.freeze_archived_connection() FROM PUBLIC;
CREATE TRIGGER freeze_archived_connection BEFORE UPDATE ON app.channel_connection FOR EACH ROW EXECUTE FUNCTION app.freeze_archived_connection();
ALTER FUNCTION app.lookup_channel_ingress(text) RENAME TO lookup_channel_ingress_pre_archive;
CREATE FUNCTION app.lookup_channel_ingress(p_public text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN IF EXISTS(SELECT 1 FROM app.channel_connection WHERE public_id=p_public AND archived_at IS NOT NULL) THEN RETURN NULL;END IF;RETURN app.lookup_channel_ingress_pre_archive(p_public);END $$;
REVOKE ALL ON FUNCTION app.lookup_channel_ingress_pre_archive(text),app.lookup_channel_ingress(text) FROM PUBLIC,cadence_ingress;
GRANT EXECUTE ON FUNCTION app.lookup_channel_ingress(text) TO cadence_ingress;
