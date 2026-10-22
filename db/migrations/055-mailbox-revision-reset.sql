CREATE FUNCTION app.reset_mailbox_sync_revision(p_id text,p_revision bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 IF app.current_role() NOT IN('owner','admin') OR app.current_role() IS NULL THEN RAISE EXCEPTION 'MAIL_ADMIN_REQUIRED';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM app.channel_connection c JOIN app.email_mailbox m ON m.workspace_id=c.workspace_id AND m.id=c.id
 WHERE c.workspace_id=ws AND c.id=p_id AND c.revision=p_revision AND c.state='pending' AND NOT m.send_verified AND NOT m.read_verified AND NOT m.proof_verified) THEN RAISE EXCEPTION 'MAIL_REVISION_CHANGED';END IF;
 UPDATE app.email_sync_cursor SET cursor=NULL,pending_cursor=NULL,lease_token=NULL,lease_until=NULL,fence=fence+1,revision=revision+1,next_at=clock_timestamp() WHERE workspace_id=ws AND mailbox_id=p_id;
END $$;
REVOKE ALL ON FUNCTION app.reset_mailbox_sync_revision(text,bigint) FROM PUBLIC,cadence_dispatcher,cadence_ingress;
GRANT EXECUTE ON FUNCTION app.reset_mailbox_sync_revision(text,bigint) TO cadence_app;
