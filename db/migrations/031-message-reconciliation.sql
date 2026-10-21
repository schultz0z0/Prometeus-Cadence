-- Preserve technical receipts after authority revocation and record explicit administrative evidence.
CREATE OR REPLACE FUNCTION app.record_message_dispatch_receipt(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_receipt jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.message_outbox;a app.message_dispatch_attempt;result_outcome jsonb;reservation app.message_usage_ledger;code text;retry_ms numeric;at timestamptz;
BEGIN
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=p_ws AND message_id=p_message FOR UPDATE;
 SELECT * INTO a FROM app.message_dispatch_attempt WHERE workspace_id=p_ws AND id=p_attempt AND message_id=p_message AND lease_token=p_token AND fence=p_fence FOR UPDATE;
 IF NOT FOUND OR a.state NOT IN('dispatching','uncertain','accepted','not_accepted') OR pg_column_size(p_receipt)>65536 THEN RAISE EXCEPTION 'INVALID_RECEIPT';END IF;
 result_outcome:=p_receipt->'outcome';IF result_outcome->>'kind' NOT IN('accepted','not_accepted','uncertain') OR p_receipt->>'attemptId'<>p_attempt THEN RAISE EXCEPTION 'INVALID_RECEIPT';END IF;
 IF a.state='accepted' THEN IF result_outcome->>'kind'='accepted' AND a.remote_id=result_outcome->>'remoteId' THEN RETURN true;ELSIF result_outcome->>'kind'='uncertain' THEN RETURN true;ELSE RAISE EXCEPTION 'RECEIPT_CONFLICT';END IF;END IF;
 IF a.state='not_accepted' AND NOT(a.outcome->>'code'='MANUALLY_RECONCILED_NOT_ACCEPTED' AND result_outcome->>'kind'='accepted') THEN IF a.outcome=result_outcome THEN RETURN true;ELSE RAISE EXCEPTION 'RECEIPT_CONFLICT';END IF;END IF;
 SELECT * INTO reservation FROM app.message_usage_ledger WHERE workspace_id=p_ws AND operation_id=p_attempt AND event='reserve';IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_REQUIRED';END IF;
 IF result_outcome->>'kind'='accepted' THEN
  IF length(result_outcome->>'remoteId') NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'INVALID_REMOTE_ID';END IF;at:=(result_outcome->>'acceptedAt')::timestamptz;
  UPDATE app.message_dispatch_attempt SET state='accepted',remote_id=result_outcome->>'remoteId',outcome=result_outcome,completed_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_attempt;
  UPDATE app.message_outbox SET state='accepted',remote_id=result_outcome->>'remoteId',accepted_at=at,lease_until=NULL WHERE workspace_id=p_ws AND message_id=p_message;
  UPDATE app.channel_message SET state='accepted',remote_id=result_outcome->>'remoteId',accepted_at=at WHERE workspace_id=p_ws AND id=p_message;
  INSERT INTO app.message_usage_ledger(workspace_id,sender_id,message_id,attempt_id,event,operation_id,period_date,cost_usd,cost_kind) VALUES(p_ws,o.sender_id,p_message,p_attempt,'consume',p_attempt,reservation.period_date,NULL,'unknown') ON CONFLICT DO NOTHING;
  INSERT INTO app.message_usage_ledger(workspace_id,sender_id,message_id,attempt_id,event,operation_id,period_date) VALUES(p_ws,o.sender_id,p_message,p_attempt,'release',p_attempt,reservation.period_date) ON CONFLICT DO NOTHING;
  PERFORM app.apply_channel_status(o.connection_id,result_outcome->>'remoteId');
  IF o.enrollment_id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM auth.member WHERE "organizationId"=p_ws AND "userId"=o.actor_id AND role IN('owner','admin')) THEN
    UPDATE app.cadence_enrollment SET state='blocked',schedule_pending=false,stop_reason='AUTHORITY_REVOKED' WHERE workspace_id=p_ws AND id=o.enrollment_id AND state='active';
   END IF;
   UPDATE app.cadence_enrollment en SET last_accepted_at=at,next_step=en.next_step+1,schedule_pending=(en.next_step+1<jsonb_array_length(pub.snapshot->'cadence'->'steps')),next_at='infinity',state=CASE WHEN en.next_step+1>=jsonb_array_length(pub.snapshot->'cadence'->'steps') THEN 'completed' ELSE 'active' END
    FROM app.cadence_publication pub WHERE en.workspace_id=p_ws AND en.id=o.enrollment_id AND en.state='active' AND en.next_step=o.step_index AND pub.workspace_id=en.workspace_id AND pub.id=en.publication_id AND pub.state='active' AND EXISTS(SELECT 1 FROM auth.member WHERE "organizationId"=p_ws AND "userId"=o.actor_id AND role IN('owner','admin'));
  END IF;
 ELSIF result_outcome->>'kind'='not_accepted' THEN
  retry_ms:=GREATEST(30000,COALESCE((result_outcome->>'retryAfterMs')::numeric,0));code:=left(result_outcome->>'code',100);
  UPDATE app.message_dispatch_attempt SET state='not_accepted',outcome=result_outcome,completed_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_attempt;
  UPDATE app.message_outbox SET state=CASE WHEN COALESCE((result_outcome->>'retryable')::boolean,false) AND attempt_count<3 AND retry_ms<=31536000000 THEN 'pending' ELSE 'failed' END,next_at=GREATEST(clock_timestamp(),(p_receipt->>'recordedAt')::timestamptz)+make_interval(secs=>LEAST(retry_ms,31536000000)::double precision/1000),blocked_code=code,lease_until=NULL WHERE workspace_id=p_ws AND message_id=p_message RETURNING state INTO code;
  UPDATE app.channel_message SET state=CASE WHEN code='pending' THEN 'pending' ELSE 'failed' END,error_code=left(result_outcome->>'code',100) WHERE workspace_id=p_ws AND id=p_message;
  INSERT INTO app.message_usage_ledger(workspace_id,sender_id,message_id,attempt_id,event,operation_id,period_date) VALUES(p_ws,o.sender_id,p_message,p_attempt,'release',p_attempt,reservation.period_date) ON CONFLICT DO NOTHING;
 ELSE
  UPDATE app.message_dispatch_attempt SET state='uncertain',outcome=result_outcome,completed_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_attempt;
  UPDATE app.message_outbox SET state='uncertain',blocked_code=left(result_outcome->>'code',100),lease_until=NULL WHERE workspace_id=p_ws AND message_id=p_message;
  UPDATE app.channel_message SET state='uncertain',error_code=left(result_outcome->>'code',100) WHERE workspace_id=p_ws AND id=p_message AND state NOT IN('delivered','read');
 END IF;
 RETURN true;
END $$;
CREATE TABLE app.message_reconciliation_evidence(
 workspace_id text NOT NULL,id text NOT NULL,message_id text NOT NULL,attempt_id text NOT NULL,actor_id text NOT NULL,
 resolution text NOT NULL CHECK(resolution IN('accepted','not_accepted')),details jsonb NOT NULL CHECK(pg_column_size(details)<=16384),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,message_id) REFERENCES app.message_outbox(workspace_id,message_id)
);
ALTER TABLE app.message_reconciliation_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.message_reconciliation_evidence FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.message_reconciliation_evidence FROM cadence_app;
CREATE POLICY tenant_read ON app.message_reconciliation_evidence FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT ON app.message_reconciliation_evidence TO cadence_app;
CREATE FUNCTION app.inspect_uncertain_message(p_message text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);o app.message_outbox;a app.message_dispatch_attempt;conn app.channel_connection;sender app.channel_sender;cred app.channel_credential;
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=ws AND message_id=p_message;
 IF NOT FOUND OR o.state<>'uncertain' THEN RAISE EXCEPTION 'RECONCILIATION_CHANGED';END IF;
 SELECT * INTO a FROM app.message_dispatch_attempt WHERE workspace_id=ws AND message_id=p_message ORDER BY attempt_number DESC LIMIT 1;
 SELECT * INTO conn FROM app.channel_connection WHERE workspace_id=ws AND id=o.connection_id;
 SELECT * INTO sender FROM app.channel_sender WHERE workspace_id=ws AND id=o.sender_id;
 SELECT * INTO cred FROM app.channel_credential WHERE workspace_id=ws AND connection_id=conn.id AND revision=(o.prepared_send->>'connectionRevision')::bigint;
 RETURN jsonb_build_object('outbox',to_jsonb(o),'attempt',to_jsonb(a),'connection',to_jsonb(conn),'sender',to_jsonb(sender),'credential',to_jsonb(cred));
END $$;
CREATE FUNCTION app.admin_reconcile_message(p_message text,p_attempt text,p_resolution text,p_remote text,p_details jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);o app.message_outbox;a app.message_dispatch_attempt;result_outcome jsonb;
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=ws AND message_id=p_message FOR UPDATE;
 IF NOT FOUND OR o.state<>'uncertain' THEN RAISE EXCEPTION 'RECONCILIATION_CHANGED';END IF;
 SELECT * INTO a FROM app.message_dispatch_attempt WHERE workspace_id=ws AND message_id=p_message AND id=p_attempt AND state='uncertain' FOR UPDATE;
 IF NOT FOUND OR p_resolution NOT IN('accepted','not_accepted') OR pg_column_size(p_details)>16384 OR length(p_details->>'evidence')<40 OR NOT COALESCE((p_details->>'verifiedByUser')::boolean,false) THEN RAISE EXCEPTION 'INVALID_EVIDENCE';END IF;
 IF p_resolution='accepted' THEN
  IF length(p_remote) NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'INVALID_EVIDENCE';END IF;
  result_outcome:=jsonb_build_object('kind','accepted','remoteId',p_remote,'acceptedAt',a.started_at);
 ELSE result_outcome:=jsonb_build_object('kind','not_accepted','code','MANUALLY_RECONCILED_NOT_ACCEPTED','retryable',false,'retryAfterMs',NULL);END IF;
 INSERT INTO app.message_reconciliation_evidence(workspace_id,id,message_id,attempt_id,actor_id,resolution,details) VALUES(ws,gen_random_uuid()::text,p_message,p_attempt,current_setting('app.user_id',true),p_resolution,p_details);
 PERFORM app.record_message_dispatch_receipt(ws,p_message,a.id,a.lease_token,a.fence,jsonb_build_object('attemptId',a.id,'outcome',result_outcome,'recordedAt',clock_timestamp(),'costUsd',NULL,'costKind','unknown'));
END $$;
REVOKE ALL ON FUNCTION app.inspect_uncertain_message(text),app.admin_reconcile_message(text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.inspect_uncertain_message(text),app.admin_reconcile_message(text,text,text,text,jsonb) TO cadence_app;
