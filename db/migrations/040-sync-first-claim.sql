-- A new cursor must be due at the caller's captured tick, not a later INSERT clock.
DO $$ DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('app.claim_mail_sync(timestamptz,text,text,integer)'::regprocedure) INTO definition;
 IF position('app.email_sync_cursor(workspace_id,mailbox_id) SELECT m.workspace_id,m.id FROM' IN definition)=0 THEN RAISE EXCEPTION 'SYNC_CLAIM_UPGRADE_REQUIRED';END IF;
 EXECUTE replace(definition,'app.email_sync_cursor(workspace_id,mailbox_id) SELECT m.workspace_id,m.id FROM','app.email_sync_cursor(workspace_id,mailbox_id,next_at) SELECT m.workspace_id,m.id,p_now FROM');
END $$;
