CREATE FUNCTION app.observe_sent_mail(p_ws text,p_mailbox text,p_mail jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.message_outbox;a app.message_dispatch_attempt;em app.email_message;found_count integer;
BEGIN
 IF p_mail->>'direction'<>'outbound' OR p_mail->>'rfcMessageId' IS NULL OR jsonb_array_length(p_mail->'to')<>1 OR COALESCE((p_mail->>'truncated')::boolean,true) THEN RETURN false;END IF;
 SELECT count(*) INTO found_count FROM app.email_message m JOIN app.message_outbox b ON b.workspace_id=m.workspace_id AND b.message_id=m.message_id
 WHERE m.workspace_id=p_ws AND m.mailbox_id=p_mailbox AND m.rfc_message_id=p_mail->>'rfcMessageId' AND m.origin='app' AND m.from_address=p_mail->>'from' AND m.to_addresses=p_mail->'to';
 IF found_count<>1 THEN RETURN false;END IF;
 SELECT m.* INTO em FROM app.email_message m JOIN app.message_outbox b ON b.workspace_id=m.workspace_id AND b.message_id=m.message_id
 WHERE m.workspace_id=p_ws AND m.mailbox_id=p_mailbox AND m.rfc_message_id=p_mail->>'rfcMessageId' AND m.origin='app' AND m.from_address=p_mail->>'from' AND m.to_addresses=p_mail->'to';
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=p_ws AND message_id=em.message_id FOR UPDATE;
 SELECT * INTO a FROM app.message_dispatch_attempt WHERE workspace_id=p_ws AND message_id=o.message_id ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE;
 IF a.state IN('dispatching','uncertain') OR(a.state='not_accepted' AND a.outcome->>'code'='MANUALLY_RECONCILED_NOT_ACCEPTED') THEN
  PERFORM app.record_message_dispatch_receipt(p_ws,o.message_id,a.id,a.lease_token,a.fence,jsonb_build_object('attemptId',a.id,'outcome',jsonb_build_object('kind','accepted','remoteId',p_mail->>'remoteId','acceptedAt',a.started_at),'recordedAt',clock_timestamp(),'costUsd',NULL,'costKind','unknown'));
 ELSIF a.state IS DISTINCT FROM 'accepted' THEN RETURN false;END IF;
 UPDATE app.email_thread SET remote_thread_id=COALESCE(remote_thread_id,p_mail->>'remoteThreadId') WHERE workspace_id=p_ws AND id=em.thread_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.observe_sent_mail(text,text,jsonb) FROM PUBLIC,cadence_app,cadence_dispatcher,cadence_ingress;
DO $$ DECLARE definition text;needle text:='  IF sender.id IS NULL THEN';BEGIN
 SELECT pg_get_functiondef('app.commit_mail_sync(text,text,text,bigint,bigint,jsonb)'::regprocedure) INTO definition;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'SENT_UPGRADE_REQUIRED';END IF;
 definition:=replace(definition,needle,
 '  IF mail->>''direction''=''outbound'' THEN
   IF app.observe_sent_mail(p_ws,p_id,mail) THEN CONTINUE;END IF;
   IF NOT EXISTS(SELECT 1 FROM app.email_thread t JOIN app.email_message m ON m.workspace_id=t.workspace_id AND m.thread_id=t.id
    WHERE t.workspace_id=p_ws AND t.mailbox_id=p_id AND m.to_addresses=mail->''to'' AND m.from_address=mail->>''from'' AND
    ((mail->>''remoteThreadId'' IS NOT NULL AND t.remote_thread_id=mail->>''remoteThreadId'') OR m.rfc_message_id=mail->>''inReplyTo'' OR m.rfc_message_id IN(SELECT jsonb_array_elements_text(mail->''references'')))) THEN CONTINUE;END IF;
  END IF;'||chr(10)||needle);
 definition:=replace(definition,' scope_data:=app.read_mail_sync',' PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;'||chr(10)||' scope_data:=app.read_mail_sync');
 EXECUTE definition;
END $$;
