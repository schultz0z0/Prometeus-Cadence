-- 16/11/2026: a due meeting reminder becomes an ordinary SDR turn waiting for approval, with app-written text (no AI, no billing).
ALTER TABLE app.sdr_turn ADD COLUMN reminder_id text;
ALTER TABLE app.sdr_turn DROP CONSTRAINT sdr_turn_workspace_id_conversation_id_inbound_message_id_fo_key;
CREATE UNIQUE INDEX sdr_turn_one_per_inbound ON app.sdr_turn(workspace_id,conversation_id,inbound_message_id,followup_attempt,reminder_id) NULLS NOT DISTINCT;

-- A lead message counts as handled once it has an AI turn or something went out after it.
CREATE FUNCTION app.sdr_inbound_handled(p_ws text,p_conversation text,p_inbound text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=p_ws AND u.conversation_id=p_conversation AND u.inbound_message_id=p_inbound AND u.reminder_id IS NULL)
  OR EXISTS(SELECT 1 FROM app.channel_message i JOIN app.channel_message o ON o.workspace_id=i.workspace_id AND o.conversation_id=i.conversation_id AND o.direction='outbound' AND o.message_order>i.message_order AND o.state NOT IN('failed','blocked','cancelled')
   WHERE i.workspace_id=p_ws AND i.id=p_inbound)
$$;
-- One due reminder at a time, only when the conversation is free and the lead's last message was answered; stale drafts are settled first.
CREATE FUNCTION app.sdr_claim_reminder(p_now timestamptz,p_workspace text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x record;
BEGIN
 -- A draft superseded by a lead message (or blocked) goes back to due; a rejected one is never drafted again.
 UPDATE app.sdr_meeting_reminder r SET state=CASE WHEN t.state='rejected' THEN 'rejected' ELSE 'due' END,turn_id=CASE WHEN t.state='rejected' THEN r.turn_id END
  FROM app.sdr_turn t WHERE r.state='drafted' AND t.workspace_id=r.workspace_id AND t.id=r.turn_id AND t.state IN('superseded','blocked','rejected')
   AND (p_workspace IS NULL OR r.workspace_id=p_workspace);
 -- A claim whose draft never happened (the worker died between the two) is due again.
 UPDATE app.sdr_meeting_reminder SET state='due' WHERE state='drafted' AND turn_id IS NULL AND (p_workspace IS NULL OR workspace_id=p_workspace);
 UPDATE app.sdr_meeting_reminder r SET state='dropped' FROM app.calendar_reservation v
  WHERE r.state IN('due','drafted') AND v.workspace_id=r.workspace_id AND v.id=r.reservation_id AND (v.state<>'accepted' OR r.deadline_at<=p_now)
   AND (p_workspace IS NULL OR r.workspace_id=p_workspace)
   AND (r.state='due' OR NOT EXISTS(SELECT 1 FROM app.sdr_turn t WHERE t.workspace_id=r.workspace_id AND t.id=r.turn_id AND t.state IN('approving','sent')));
 -- The consent recorded for reminders lasts only while the meeting stands: gone once it is cancelled or has started
 -- (an approved reminder may still be waiting in the send queue until then).
 DELETE FROM app.consent_evidence e WHERE e.source='sdr-meeting-reminder' AND (p_workspace IS NULL OR e.workspace_id=p_workspace)
  AND EXISTS(SELECT 1 FROM app.sdr_meeting_reminder r WHERE r.workspace_id=e.workspace_id AND r.evidence_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM app.sdr_meeting_reminder r JOIN app.calendar_reservation v ON v.workspace_id=r.workspace_id AND v.id=r.reservation_id
   WHERE r.workspace_id=e.workspace_id AND r.evidence_id=e.id AND v.state='accepted' AND v.start_at>p_now);
 FOR x IN SELECT r.workspace_id,r.id,r.conversation_id,r.kind,v.start_at,v.timezone,v.meet_url,v.sdr_presence,cc.lead_id
   FROM app.sdr_meeting_reminder r JOIN app.calendar_reservation v ON v.workspace_id=r.workspace_id AND v.id=r.reservation_id
   JOIN app.channel_conversation cc ON cc.workspace_id=r.workspace_id AND cc.id=r.conversation_id
  WHERE r.state='due' AND r.due_at<=p_now AND r.deadline_at>p_now AND v.state='accepted' AND (p_workspace IS NULL OR r.workspace_id=p_workspace)
   AND EXISTS(SELECT 1 FROM app.sdr_agent_for_connection(cc.connection_id) a WHERE a.config->>'objective'='meetings' AND coalesce((a.config->>'meetingReminders')::boolean,true))
   AND NOT EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=r.workspace_id AND u.conversation_id=r.conversation_id AND u.state IN('claimed','queued','pending-approval','uncertain','approving'))
  ORDER BY r.due_at LIMIT 20
 LOOP
  CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('sdr-conversation:'||x.conversation_id,0));
  CONTINUE WHEN NOT app.sdr_thread_open(x.workspace_id,x.conversation_id,(SELECT m.id FROM app.channel_message m WHERE m.workspace_id=x.workspace_id AND m.conversation_id=x.conversation_id AND m.direction='inbound' ORDER BY m.message_order DESC LIMIT 1))
   OR NOT app.sdr_inbound_handled(x.workspace_id,x.conversation_id,(SELECT m.id FROM app.channel_message m WHERE m.workspace_id=x.workspace_id AND m.conversation_id=x.conversation_id AND m.direction='inbound' ORDER BY m.message_order DESC LIMIT 1));
  UPDATE app.sdr_meeting_reminder SET state='drafted' WHERE workspace_id=x.workspace_id AND id=x.id AND state='due';
  CONTINUE WHEN NOT FOUND;
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
 IF a.agent_id IS NULL OR inb IS NULL OR NOT app.sdr_thread_open(p_ws,r.conversation_id,inb) OR NOT app.sdr_inbound_handled(p_ws,r.conversation_id,inb)
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
-- A reminder turn never stands for the lead message it was drafted under: that message still gets its AI turn.
CREATE OR REPLACE FUNCTION app.sdr_claim_turn(p_token text, p_now timestamp with time zone, p_workspace text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE t app.sdr_turn;x record;f record;
BEGIN
 UPDATE app.sdr_turn SET state='uncertain',reason='WORKER_LOST' WHERE state='claimed' AND lease_until<=p_now AND (p_workspace IS NULL OR workspace_id=p_workspace);
 FOR t IN SELECT u.* FROM app.sdr_turn u JOIN app.channel_conversation cc ON cc.workspace_id=u.workspace_id AND cc.id=u.conversation_id
   WHERE u.state IN('pending-approval','uncertain') AND (p_workspace IS NULL OR u.workspace_id=p_workspace)
    AND (u.created_at<p_now-interval '7 days' OR EXISTS(SELECT 1 FROM app.contact_suppression c WHERE c.workspace_id=cc.workspace_id AND c.identity_id=cc.identity_id AND c.scope IN('all','service')))
   ORDER BY u.created_at LIMIT 50 FOR UPDATE OF u SKIP LOCKED LOOP
  PERFORM app.sdr_act_as(t.workspace_id),app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='superseded',decided_at=clock_timestamp() WHERE workspace_id=t.workspace_id AND id=t.id;
 END LOOP;
 -- Follow-ups that must stop; only those rows compete for the window.
 FOR f IN SELECT q.* FROM (SELECT s.workspace_id,s.conversation_id,s.next_at,CASE
    WHEN EXISTS(SELECT 1 FROM app.contact_suppression c WHERE c.workspace_id=s.workspace_id AND c.identity_id=s.identity_id AND c.scope IN('all','service')) THEN 'OPT_OUT'
    WHEN EXISTS(SELECT 1 FROM app.sdr_thread_state o WHERE o.workspace_id=s.workspace_id AND o.conversation_id=s.conversation_id AND o.owner='human') THEN 'HUMAN'
    WHEN s.inbound_message_id<>(SELECT i.id FROM app.channel_message i WHERE i.workspace_id=s.workspace_id AND i.conversation_id=s.conversation_id AND i.direction='inbound' ORDER BY i.message_order DESC LIMIT 1) THEN 'REPLIED'
    WHEN s.expires_at<=p_now THEN 'EXPIRED'
    WHEN NOT EXISTS(SELECT 1 FROM app.sdr_channel_binding b JOIN app.sdr_agent_revision r ON r.workspace_id=b.workspace_id AND r.agent_id=b.agent_id AND r.revision=b.revision WHERE b.workspace_id=s.workspace_id AND b.connection_id=cc.connection_id AND (r.config->>'followupEnabled')::boolean) THEN 'AGENT_OFF' END reason
   FROM app.sdr_followup s JOIN app.channel_conversation cc ON cc.workspace_id=s.workspace_id AND cc.id=s.conversation_id
   WHERE s.state='active' AND (p_workspace IS NULL OR s.workspace_id=p_workspace)) q WHERE q.reason IS NOT NULL ORDER BY q.next_at LIMIT 100 LOOP
  PERFORM app.sdr_act_as(f.workspace_id),app.sdr_followup_end(f.workspace_id,f.conversation_id,f.reason);
 END LOOP;
 -- Evidence kept for an accepted message goes once its short validity passes.
 DELETE FROM app.consent_evidence e USING app.sdr_followup s WHERE e.workspace_id=s.workspace_id AND e.id=s.evidence_id AND s.state='ended' AND s.expires_at<=p_now AND (p_workspace IS NULL OR s.workspace_id=p_workspace);
 FOR t IN SELECT * FROM app.sdr_turn WHERE state='queued' AND (p_workspace IS NULL OR workspace_id=p_workspace) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20 LOOP
  IF app.sdr_turn_eligible(t) THEN
   UPDATE app.sdr_turn SET state='claimed',lease_token=p_token,lease_until=p_now+interval '5 minutes' WHERE workspace_id=t.workspace_id AND id=t.id RETURNING * INTO t;
   RETURN app.sdr_turn_payload(t);
  END IF;
  PERFORM app.sdr_act_as(t.workspace_id),app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='superseded',decided_at=clock_timestamp() WHERE workspace_id=t.workspace_id AND id=t.id;
 END LOOP;
 t:=NULL;
 FOR x IN SELECT b.workspace_id,cc.id conversation_id,m.id inbound_id,a.agent_id,a.revision,a.config FROM app.sdr_channel_binding b
   JOIN app.channel_conversation cc ON cc.workspace_id=b.workspace_id AND cc.connection_id=b.connection_id AND cc.channel='WHATSAPP'
   CROSS JOIN LATERAL app.sdr_agent_for_connection(b.connection_id) a
   CROSS JOIN LATERAL (SELECT i.id,i.created_at,i.text,i.message_order FROM app.channel_message i WHERE i.workspace_id=cc.workspace_id AND i.conversation_id=cc.id AND i.direction='inbound' ORDER BY i.message_order DESC LIMIT 1) m
  WHERE (p_workspace IS NULL OR b.workspace_id=p_workspace) AND m.text IS NOT NULL AND m.created_at>=b.created_at AND app.sdr_within_hours(a.config->'hours',p_now)
   AND EXISTS(SELECT 1 FROM auth.member mm WHERE mm."organizationId"=b.workspace_id)
   AND NOT EXISTS(SELECT 1 FROM app.channel_message o WHERE o.workspace_id=cc.workspace_id AND o.conversation_id=cc.id AND o.direction='outbound' AND o.message_order>m.message_order AND o.state NOT IN('failed','blocked','cancelled'))
   AND NOT EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=cc.workspace_id AND u.conversation_id=cc.id AND ((u.inbound_message_id=m.id AND u.reminder_id IS NULL) OR u.state='claimed'))
   AND NOT EXISTS(SELECT 1 FROM app.sdr_thread_state s WHERE s.workspace_id=cc.workspace_id AND s.conversation_id=cc.id AND s.owner='human')
   AND NOT EXISTS(SELECT 1 FROM app.contact_suppression c WHERE c.workspace_id=cc.workspace_id AND c.identity_id=cc.identity_id AND c.scope IN('all','service'))
  ORDER BY m.created_at LIMIT 50
 LOOP
  CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('sdr-conversation:'||x.conversation_id,0));
  CONTINUE WHEN NOT app.sdr_thread_open(x.workspace_id,x.conversation_id,x.inbound_id) OR EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=x.workspace_id AND u.conversation_id=x.conversation_id AND u.state='claimed');
  t:=app.sdr_begin_turn(x.workspace_id,x.conversation_id,x.inbound_id,x.agent_id,x.revision,x.config,p_token,p_now,0);
  IF t.id IS NOT NULL THEN RETURN app.sdr_turn_payload(t);END IF;
 END LOOP;
 -- Returns due: consent on file, agent still offering follow-up, in hours, nothing waiting for a person. Every gate before the limit.
 FOR x IN SELECT s.workspace_id,s.id followup_id,s.conversation_id,s.inbound_message_id inbound_id,s.attempts,a.agent_id,a.revision,a.config FROM app.sdr_followup s
   JOIN app.channel_conversation cc ON cc.workspace_id=s.workspace_id AND cc.id=s.conversation_id
   CROSS JOIN LATERAL app.sdr_agent_for_connection(cc.connection_id) a
  WHERE s.state='active' AND s.attempts<2 AND s.next_at<=p_now AND s.expires_at>p_now AND (p_workspace IS NULL OR s.workspace_id=p_workspace)
   AND (a.config->>'followupEnabled')::boolean AND app.sdr_within_hours(a.config->'hours',p_now) AND app.sdr_thread_open(s.workspace_id,s.conversation_id,s.inbound_message_id)
   AND EXISTS(SELECT 1 FROM auth.member mm WHERE mm."organizationId"=s.workspace_id)
   AND NOT EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=s.workspace_id AND u.conversation_id=s.conversation_id AND u.state IN('claimed','queued','pending-approval','uncertain'))
  ORDER BY s.next_at LIMIT 50
 LOOP
  CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('sdr-conversation:'||x.conversation_id,0));
  -- Re-read under the lock: another worker or a withdrawal may have got here first.
  CONTINUE WHEN NOT EXISTS(SELECT 1 FROM app.sdr_followup s WHERE s.workspace_id=x.workspace_id AND s.id=x.followup_id AND s.state='active' AND s.attempts=x.attempts AND s.next_at<=p_now)
   OR NOT app.sdr_thread_open(x.workspace_id,x.conversation_id,x.inbound_id);
  t:=app.sdr_begin_turn(x.workspace_id,x.conversation_id,x.inbound_id,x.agent_id,x.revision,x.config,p_token,p_now,x.attempts+1);
  IF t.id IS NOT NULL THEN
   UPDATE app.sdr_followup SET attempts=attempts+1,next_at=p_now+interval '24 hours' WHERE workspace_id=x.workspace_id AND id=x.followup_id;
   RETURN app.sdr_turn_payload(t);
  END IF;
  -- Blocked by limit or quota: no attempt spent, the consent tries again tomorrow within its validity.
  DELETE FROM app.sdr_turn WHERE workspace_id=x.workspace_id AND conversation_id=x.conversation_id AND inbound_message_id=x.inbound_id AND followup_attempt=x.attempts+1 AND state='blocked';
  UPDATE app.sdr_followup SET next_at=p_now+interval '24 hours' WHERE workspace_id=x.workspace_id AND id=x.followup_id;
 END LOOP;
 RETURN NULL;
END $function$;
CREATE OR REPLACE FUNCTION app.sdr_purge_turn_text()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 UPDATE app.sdr_turn SET text=NULL,fields='[]',proposal=NULL WHERE workspace_id=NEW.workspace_id AND (inbound_message_id=NEW.id OR message_id=NEW.id);
 UPDATE app.consent_evidence e SET evidence='[removido]' FROM app.sdr_followup f WHERE f.workspace_id=NEW.workspace_id AND f.inbound_message_id=NEW.id AND e.workspace_id=f.workspace_id AND e.id=f.evidence_id;
 UPDATE app.sdr_followup SET quote='[removido]' WHERE workspace_id=NEW.workspace_id AND inbound_message_id=NEW.id;
 -- The lead's words copied into a meeting reminder's consent evidence are redacted too.
 UPDATE app.consent_evidence e SET evidence='[removido]' FROM app.sdr_meeting_reminder r WHERE r.workspace_id=NEW.workspace_id AND r.evidence_message_id=NEW.id AND e.workspace_id=r.workspace_id AND e.id=r.evidence_id;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION app.sdr_claim_reminder(timestamptz,text),app.sdr_draft_reminder(text,text,text),app.sdr_inbound_handled(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sdr_claim_reminder(timestamptz,text),app.sdr_draft_reminder(text,text,text) TO cadence_worker;
