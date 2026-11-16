-- 16/11/2026: a due meeting reminder becomes an ordinary SDR turn waiting for approval, with app-written text (no AI, no billing).
ALTER TABLE app.sdr_turn ADD COLUMN reminder_id text;
ALTER TABLE app.sdr_turn DROP CONSTRAINT sdr_turn_workspace_id_conversation_id_inbound_message_id_fo_key;
CREATE UNIQUE INDEX sdr_turn_one_per_inbound ON app.sdr_turn(workspace_id,conversation_id,inbound_message_id,followup_attempt,reminder_id) NULLS NOT DISTINCT;

-- One due reminder at a time, only when the conversation is free; stale drafts are settled first.
CREATE FUNCTION app.sdr_claim_reminder(p_now timestamptz,p_workspace text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x record;
BEGIN
 -- A draft superseded by a lead message (or blocked) goes back to due; a rejected one is never drafted again.
 UPDATE app.sdr_meeting_reminder r SET state=CASE WHEN t.state='rejected' THEN 'rejected' ELSE 'due' END,turn_id=CASE WHEN t.state='rejected' THEN r.turn_id END
  FROM app.sdr_turn t WHERE r.state='drafted' AND t.workspace_id=r.workspace_id AND t.id=r.turn_id AND t.state IN('superseded','blocked','rejected')
   AND (p_workspace IS NULL OR r.workspace_id=p_workspace);
 UPDATE app.sdr_meeting_reminder r SET state='dropped' FROM app.calendar_reservation v
  WHERE r.state IN('due','drafted') AND v.workspace_id=r.workspace_id AND v.id=r.reservation_id AND (v.state<>'accepted' OR r.deadline_at<=p_now)
   AND (p_workspace IS NULL OR r.workspace_id=p_workspace)
   AND (r.state='due' OR NOT EXISTS(SELECT 1 FROM app.sdr_turn t WHERE t.workspace_id=r.workspace_id AND t.id=r.turn_id AND t.state IN('approving','sent')));
 FOR x IN SELECT r.workspace_id,r.id,r.conversation_id,r.kind,v.start_at,v.timezone,v.meet_url,v.sdr_presence,cc.lead_id
   FROM app.sdr_meeting_reminder r JOIN app.calendar_reservation v ON v.workspace_id=r.workspace_id AND v.id=r.reservation_id
   JOIN app.channel_conversation cc ON cc.workspace_id=r.workspace_id AND cc.id=r.conversation_id
  WHERE r.state='due' AND r.due_at<=p_now AND r.deadline_at>p_now AND v.state='accepted' AND (p_workspace IS NULL OR r.workspace_id=p_workspace)
   AND EXISTS(SELECT 1 FROM app.sdr_agent_for_connection(cc.connection_id) a WHERE a.config->>'objective'='meetings' AND coalesce((a.config->>'meetingReminders')::boolean,true))
   AND NOT EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=r.workspace_id AND u.conversation_id=r.conversation_id AND u.state IN('claimed','queued','pending-approval','uncertain','approving'))
  ORDER BY r.due_at LIMIT 20
 LOOP
  CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('sdr-conversation:'||x.conversation_id,0));
  CONTINUE WHEN NOT app.sdr_thread_open(x.workspace_id,x.conversation_id,(SELECT m.id FROM app.channel_message m WHERE m.workspace_id=x.workspace_id AND m.conversation_id=x.conversation_id AND m.direction='inbound' ORDER BY m.message_order DESC LIMIT 1));
  UPDATE app.sdr_meeting_reminder SET state='drafted' WHERE workspace_id=x.workspace_id AND id=x.id;
  RETURN jsonb_build_object('reminderId',x.id,'workspaceId',x.workspace_id,'conversationId',x.conversation_id,'kind',x.kind,
   'start',to_char(x.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timezone',x.timezone,'meetUrl',x.meet_url,'confirmed',x.sdr_presence='confirmed',
   'name',(SELECT coalesce(nullif(l.payload->'sdrProfile'->>'personName',''),l.payload->>'name') FROM app.lead l WHERE l.workspace_id=x.workspace_id AND l.id=x.lead_id));
 END LOOP;
 RETURN NULL;
END $$;

-- The drafted reminder as a turn waiting for approval. A conversation that stopped being free sends it back to due.
CREATE FUNCTION app.sdr_draft_reminder(p_ws text,p_reminder text,p_text text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.sdr_meeting_reminder;cc app.channel_conversation;a record;inb text;tid text;
BEGIN
 SELECT * INTO r FROM app.sdr_meeting_reminder WHERE workspace_id=p_ws AND id=p_reminder AND state='drafted' AND turn_id IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sdr-conversation:'||r.conversation_id,0));
 SELECT * INTO cc FROM app.channel_conversation WHERE workspace_id=p_ws AND id=r.conversation_id;
 SELECT * INTO a FROM app.sdr_agent_for_connection(cc.connection_id) LIMIT 1;
 SELECT m.id INTO inb FROM app.channel_message m WHERE m.workspace_id=p_ws AND m.conversation_id=r.conversation_id AND m.direction='inbound' ORDER BY m.message_order DESC LIMIT 1;
 IF a.agent_id IS NULL OR inb IS NULL OR NOT app.sdr_thread_open(p_ws,r.conversation_id,inb)
   OR EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=p_ws AND u.conversation_id=r.conversation_id AND u.state IN('claimed','queued','pending-approval','uncertain','approving')) THEN
  UPDATE app.sdr_meeting_reminder SET state='due' WHERE workspace_id=p_ws AND id=p_reminder;RETURN NULL;
 END IF;
 INSERT INTO app.sdr_turn(workspace_id,conversation_id,inbound_message_id,agent_id,agent_revision,state,text,reminder_id,proposal)
  VALUES(p_ws,r.conversation_id,inb,a.agent_id,a.revision,'pending-approval',left(p_text,4096),p_reminder,jsonb_build_object('kind','reminder','reminderId',p_reminder)) ON CONFLICT DO NOTHING RETURNING id INTO tid;
 -- Already drafted once for this same lead message (a blocked draft): not drafted twice.
 IF tid IS NULL THEN UPDATE app.sdr_meeting_reminder SET state='dropped' WHERE workspace_id=p_ws AND id=p_reminder;RETURN NULL;END IF;
 UPDATE app.sdr_meeting_reminder SET turn_id=tid WHERE workspace_id=p_ws AND id=p_reminder;
 RETURN tid;
END $$;

-- Approval: a reminder is valid only while its meeting stands and has not started.
CREATE OR REPLACE FUNCTION app.sdr_check_approval(p_turn text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.sdr_turn;
BEGIN
 PERFORM app.sdr_role(false);
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sdr-conversation:'||t.conversation_id,0));
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn FOR UPDATE;
 IF t.state<>'pending-approval' OR NOT app.sdr_thread_open(ws,t.conversation_id,t.inbound_message_id) THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 IF t.reminder_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM app.sdr_meeting_reminder r JOIN app.calendar_reservation v ON v.workspace_id=r.workspace_id AND v.id=r.reservation_id
    WHERE r.workspace_id=ws AND r.id=t.reminder_id AND r.state='drafted' AND r.turn_id=t.id AND v.state='accepted' AND clock_timestamp()<r.deadline_at) THEN RAISE EXCEPTION 'SDR_REMINDER_STALE';END IF;
  RETURN;
 END IF;
 IF t.followup_attempt>0 THEN
  IF NOT EXISTS(SELECT 1 FROM app.sdr_followup f WHERE f.workspace_id=ws AND f.conversation_id=t.conversation_id AND f.state='active' AND f.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'SDR_STATE';END IF;
  IF EXISTS(SELECT 1 FROM app.channel_message o WHERE o.workspace_id=ws AND o.conversation_id=t.conversation_id AND o.direction='outbound' AND o.state NOT IN('failed','blocked','cancelled') AND o.created_at>clock_timestamp()-interval '24 hours') THEN RAISE EXCEPTION 'SDR_FOLLOWUP_TOO_SOON';END IF;
 -- The recorded consent is for returns, not for a late answer to the original message outside the window.
 ELSIF EXISTS(SELECT 1 FROM app.sdr_followup f JOIN app.channel_conversation cc ON cc.workspace_id=f.workspace_id AND cc.id=f.conversation_id WHERE f.workspace_id=ws AND f.conversation_id=t.conversation_id AND f.state='active' AND cc.last_inbound_at<clock_timestamp()-interval '24 hours') THEN RAISE EXCEPTION 'SDR_STATE';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_approve_turn(p_turn text,p_message text,p_text text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.sdr_turn;
BEGIN
 PERFORM app.sdr_role(false);
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn AND state='pending-approval' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 IF t.reserved THEN PERFORM app.billing_consume('sdr-turn:'||t.id,'sdr',1,'sdr-turn:'||t.id),app.billing_release('sdr-turn:'||t.id);END IF;
 UPDATE app.sdr_turn SET state='sent',reserved=false,text=p_text,message_id=p_message,decided_by=current_setting('app.user_id',true),decided_at=clock_timestamp() WHERE workspace_id=ws AND id=p_turn;
 -- 24 h count from what actually went out, not from when the draft was written.
 UPDATE app.sdr_followup SET next_at=clock_timestamp()+interval '24 hours' WHERE workspace_id=ws AND conversation_id=t.conversation_id AND state='active';
 IF t.followup_attempt>=2 THEN PERFORM app.sdr_followup_end(ws,t.conversation_id,'COMPLETED');END IF;
 -- A reminder that went out: the lead now owes an answer, unless they had already confirmed.
 IF t.reminder_id IS NOT NULL THEN
  UPDATE app.sdr_meeting_reminder SET state='sent' WHERE workspace_id=ws AND id=t.reminder_id;
  UPDATE app.calendar_reservation v SET sdr_presence='pending' FROM app.sdr_meeting_reminder r
   WHERE r.workspace_id=ws AND r.id=t.reminder_id AND v.workspace_id=ws AND v.id=r.reservation_id AND v.sdr_presence IS DISTINCT FROM 'confirmed';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_reject_turn(p_turn text) RETURNS app.sdr_turn LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.sdr_turn;
BEGIN
 PERFORM app.sdr_role(false);
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn AND state='pending-approval' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 PERFORM app.sdr_release_turn(t);
 UPDATE app.sdr_turn SET state='rejected',decided_by=current_setting('app.user_id',true),decided_at=clock_timestamp() WHERE workspace_id=ws AND id=p_turn RETURNING * INTO t;
 -- Rejecting a return means no more returns: the next day must not bring another draft.
 IF t.followup_attempt>0 THEN PERFORM app.sdr_followup_end(ws,t.conversation_id,'REJECTED');END IF;
 IF t.reminder_id IS NOT NULL THEN UPDATE app.sdr_meeting_reminder SET state='rejected' WHERE workspace_id=ws AND id=t.reminder_id;END IF;
 RETURN t;
END $$;
REVOKE ALL ON FUNCTION app.sdr_claim_reminder(timestamptz,text),app.sdr_draft_reminder(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sdr_claim_reminder(timestamptz,text),app.sdr_draft_reminder(text,text,text) TO cadence_worker;
