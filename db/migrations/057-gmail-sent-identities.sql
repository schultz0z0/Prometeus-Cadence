-- Gmail may replace the proposed MIME Message-ID. Learn its actual identity
-- only from the exact accepted provider receipt and matching sender/recipient.
CREATE OR REPLACE FUNCTION app.observe_sent_mail(p_ws text,p_mailbox text,p_mail jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.message_outbox;a app.message_dispatch_attempt;em app.email_message;found_count integer;
BEGIN
 IF p_mail->>'direction'<>'outbound' OR p_mail->>'rfcMessageId' IS NULL OR jsonb_array_length(p_mail->'to')<>1 OR COALESCE((p_mail->>'truncated')::boolean,true) THEN RETURN false;END IF;
 SELECT count(*) INTO found_count FROM app.email_message e
 JOIN app.channel_message cm ON cm.workspace_id=e.workspace_id AND cm.id=e.message_id
 JOIN app.message_outbox b ON b.workspace_id=e.workspace_id AND b.message_id=e.message_id
 JOIN app.email_thread t ON t.workspace_id=e.workspace_id AND t.id=e.thread_id
 WHERE e.workspace_id=p_ws AND e.mailbox_id=p_mailbox AND e.origin='app'
 AND cm.connection_id=p_mailbox AND cm.direction='outbound' AND cm.state='accepted'
 AND b.state='accepted' AND b.remote_id=p_mail->>'remoteId' AND cm.remote_id=b.remote_id
 AND e.from_address=p_mail->>'from' AND e.to_addresses=p_mail->'to'
 AND (t.remote_thread_id IS NULL OR t.remote_thread_id=p_mail->>'remoteThreadId');
 IF found_count=1 THEN
  SELECT e.* INTO em FROM app.email_message e
  JOIN app.channel_message cm ON cm.workspace_id=e.workspace_id AND cm.id=e.message_id
  JOIN app.message_outbox b ON b.workspace_id=e.workspace_id AND b.message_id=e.message_id
  JOIN app.email_thread t ON t.workspace_id=e.workspace_id AND t.id=e.thread_id
  WHERE e.workspace_id=p_ws AND e.mailbox_id=p_mailbox AND e.origin='app'
  AND cm.connection_id=p_mailbox AND cm.direction='outbound' AND cm.state='accepted'
  AND b.state='accepted' AND b.remote_id=p_mail->>'remoteId' AND cm.remote_id=b.remote_id
  AND e.from_address=p_mail->>'from' AND e.to_addresses=p_mail->'to'
  AND (t.remote_thread_id IS NULL OR t.remote_thread_id=p_mail->>'remoteThreadId');
  UPDATE app.email_message SET rfc_message_id=p_mail->>'rfcMessageId' WHERE workspace_id=p_ws AND message_id=em.message_id;
  UPDATE app.email_thread SET remote_thread_id=COALESCE(remote_thread_id,p_mail->>'remoteThreadId') WHERE workspace_id=p_ws AND id=em.thread_id;
  UPDATE app.channel_message SET occurred_at=COALESCE(occurred_at,(p_mail->>'receivedAt')::timestamptz) WHERE workspace_id=p_ws AND id=em.message_id;
  RETURN true;
 END IF;
 -- Preserve the original exact-RFC reconciliation for uncertain SMTP/Gmail sends.
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
DO $upgrade$ DECLARE definition text;needle text:=$needle$ FOR mail IN SELECT value FROM jsonb_array_elements(p_batch->'messages') LOOP$needle$;BEGIN
 SELECT pg_get_functiondef('app.commit_mail_sync(text,text,text,bigint,bigint,jsonb)'::regprocedure) INTO definition;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'SENT_METADATA_UPGRADE_REQUIRED';END IF;
 definition:=replace(definition,needle,$prepass$
 -- Observe sent metadata before replies, regardless of provider history order.
 FOR mail IN SELECT value FROM jsonb_array_elements(p_batch->'messages') LOOP
  IF mail->>'direction'='outbound' THEN PERFORM app.observe_sent_mail(p_ws,p_id,mail);END IF;
 END LOOP;
$prepass$||needle);
 EXECUTE definition;
END $upgrade$;
