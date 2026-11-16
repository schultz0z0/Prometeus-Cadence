-- 16/11/2026: an OpenWA logout the gateway could not confirm (e.g. pairing already expired) ends stopped, with its key revoked,
-- but in action_required forever; the owner can still remove it from the list. The unconfirmed state stays visible until then.
CREATE OR REPLACE FUNCTION app.archive_channel_connection(p_id text,p_revision bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.channel_connection;ws text:=current_setting('app.workspace_id',true);
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHANNEL_NOT_FOUND';END IF;
 IF c.revision<>p_revision OR c.channel NOT IN('WHATSAPP','EMAIL') OR c.state<>'disconnected' OR c.archived_at IS NOT NULL THEN RAISE EXCEPTION 'ARCHIVE_NOT_READY';END IF;
 IF EXISTS(SELECT 1 FROM app.openwa_connection WHERE workspace_id=ws AND connection_id=p_id AND (desired_state<>'disconnected' OR stage<>'idle' OR NOT(phase='disconnected' OR (phase='action_required' AND error_code='OPENWA_UNLINK_UNCONFIRMED')))) OR EXISTS(SELECT 1 FROM app.message_outbox WHERE workspace_id=ws AND connection_id=p_id AND state IN('pending','dispatching','uncertain')) THEN RAISE EXCEPTION 'ARCHIVE_PENDING_WORK';END IF;
 UPDATE app.channel_connection SET archived_at=clock_timestamp(),revision=revision+1,credentials_verified=false,challenge_verified=false,last_error=NULL,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id;
 UPDATE app.channel_sender SET ready=false WHERE workspace_id=ws AND connection_id=p_id;
 DELETE FROM app.channel_credential WHERE workspace_id=ws AND connection_id=p_id;
 DELETE FROM app.channel_account_ownership WHERE workspace_id=ws AND connection_id=p_id;
 UPDATE app.channel_received_event SET time_lookup_state='done',lookup_token=NULL,lookup_until=NULL WHERE workspace_id=ws AND connection_id=p_id AND time_lookup_state<>'none';
END $$;
