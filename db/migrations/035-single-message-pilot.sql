-- Pilot claims may narrow to exactly the reviewed outbox message.
CREATE FUNCTION app.claim_message_dispatch(p_now timestamptz,p_workspace text,p_message text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate record;o app.message_outbox;a app.message_dispatch_attempt;token text;attempt_id text;
BEGIN
 FOR candidate IN SELECT workspace_id,message_id FROM app.message_outbox WHERE (p_workspace IS NULL OR workspace_id=p_workspace) AND (p_message IS NULL OR message_id=p_message) AND ((state='pending' AND next_at<=p_now AND (lease_until IS NULL OR lease_until<clock_timestamp())) OR (state='dispatching' AND lease_until<clock_timestamp())) ORDER BY next_at,message_id LIMIT 100 LOOP
  PERFORM 1 FROM app.workspace_meta WHERE workspace_id=candidate.workspace_id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;
  SELECT * INTO o FROM app.message_outbox WHERE workspace_id=candidate.workspace_id AND message_id=candidate.message_id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;
  IF o.state='dispatching' AND o.lease_until<clock_timestamp() THEN
   UPDATE app.message_outbox SET state='uncertain',blocked_code='DISPATCH_RECEIPT_MISSING' WHERE workspace_id=o.workspace_id AND message_id=o.message_id;
   UPDATE app.channel_message SET state='uncertain' WHERE workspace_id=o.workspace_id AND id=o.message_id AND state NOT IN('delivered','read');
   UPDATE app.message_dispatch_attempt SET state='uncertain' WHERE workspace_id=o.workspace_id AND message_id=o.message_id AND state='dispatching';CONTINUE;
  END IF;
  IF o.state<>'pending' OR o.next_at>p_now OR o.lease_until>clock_timestamp() THEN CONTINUE;END IF;
  IF o.attempt_count>=3 THEN UPDATE app.message_outbox SET state='failed',blocked_code='RETRY_EXHAUSTED' WHERE workspace_id=o.workspace_id AND message_id=o.message_id;CONTINUE;END IF;
  token:=gen_random_uuid()::text;attempt_id:=gen_random_uuid()::text;
  UPDATE app.message_outbox SET fence=fence+1,lease_token=token,lease_until=clock_timestamp()+interval '60 seconds' WHERE workspace_id=o.workspace_id AND message_id=o.message_id RETURNING * INTO o;
  SELECT * INTO a FROM app.message_dispatch_attempt WHERE workspace_id=o.workspace_id AND message_id=o.message_id AND attempt_number=o.attempt_count+1;
  IF FOUND AND a.state='prepared' THEN
   attempt_id:=a.id;UPDATE app.message_dispatch_attempt SET fence=o.fence,lease_token=token WHERE workspace_id=o.workspace_id AND id=a.id;
  ELSE INSERT INTO app.message_dispatch_attempt(workspace_id,id,message_id,attempt_number,fence,lease_token,state) VALUES(o.workspace_id,attempt_id,o.message_id,o.attempt_count+1,o.fence,token,'prepared');END IF;
  RETURN jsonb_build_object('workspaceId',o.workspace_id,'messageId',o.message_id,'attemptId',attempt_id,'token',token,'fence',o.fence,'expiresAt',o.lease_until);
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION app.claim_message_dispatch(timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_message_dispatch(timestamptz,text,text) TO cadence_dispatcher;
CREATE OR REPLACE FUNCTION app.claim_message_dispatch(p_now timestamptz,p_workspace text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app.claim_message_dispatch(p_now,p_workspace,NULL); $$;
