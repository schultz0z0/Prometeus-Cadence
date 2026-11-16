-- 16/11/2026: the lead's answer about the booked meeting. The AI turn carries a presence proposal; a person's approval applies it.
-- A meeting the lead asked to reschedule no longer blocks a new booking; the new one is booked first, then the old one cancelled (in the app).

-- The conversation's current meeting (accepted, not over) and the last reminder sent for it.
CREATE OR REPLACE FUNCTION app.sdr_turn_payload(t app.sdr_turn) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.sdr_turn_payload_v122(t)||jsonb_build_object(
  'progress',(SELECT jsonb_build_object('stage',s.stage,'answers',s.answers,'attempts',s.attempts,'asked',s.asked,'offer',s.offer) FROM app.sdr_thread_state s WHERE s.workspace_id=t.workspace_id AND s.conversation_id=t.conversation_id),
  'leadId',(SELECT cc.lead_id FROM app.channel_conversation cc WHERE cc.workspace_id=t.workspace_id AND cc.id=t.conversation_id),
  'conversationId',t.conversation_id,
  'calendarReady',EXISTS(SELECT 1 FROM app.integration_connection c WHERE c.workspace_id=t.workspace_id AND c.kind='google-calendar' AND c.state='ready' AND c.config IS NOT NULL AND c.attention IS NULL AND c.secret IS NOT NULL),
  'reminder',(SELECT jsonb_build_object('reservationId',r.id,'start',to_char(r.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
     'kind',(SELECT m.kind FROM app.sdr_meeting_reminder m WHERE m.workspace_id=r.workspace_id AND m.reservation_id=r.id AND m.state='sent' ORDER BY m.due_at DESC LIMIT 1))
   FROM app.sdr_business_action a JOIN app.calendar_reservation r ON r.workspace_id=a.workspace_id AND r.request_id=a.request_id
   WHERE a.workspace_id=t.workspace_id AND a.conversation_id=t.conversation_id AND r.state='accepted' AND r.end_at>clock_timestamp() ORDER BY a.created_at DESC,a.id LIMIT 1))
$$;

CREATE OR REPLACE FUNCTION app.sdr_booking_active(p_conversation text,p_request text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.sdr_business_action b LEFT JOIN app.calendar_reservation r ON r.workspace_id=b.workspace_id AND r.request_id=b.request_id
  WHERE b.workspace_id=current_setting('app.workspace_id',true) AND b.conversation_id=p_conversation AND b.request_id IS DISTINCT FROM p_request AND app.current_role() IS NOT NULL
   AND (r.state IN('prepared','uncertain') OR (r.state='accepted' AND r.end_at>clock_timestamp() AND r.sdr_presence IS DISTINCT FROM 'reschedule') OR (r.id IS NULL AND b.created_at>clock_timestamp()-interval '10 minutes')))
$$;

CREATE OR REPLACE FUNCTION app.sdr_booking_view(p_conversation text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',r.id,'start',to_char(r.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'end',to_char(r.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'state',r.state,'revision',r.revision,'timezone',r.timezone,'meetUrl',r.meet_url,'presence',r.sdr_presence)
 FROM app.sdr_business_action a JOIN app.calendar_reservation r ON r.workspace_id=a.workspace_id AND r.request_id=a.request_id
 WHERE a.workspace_id=current_setting('app.workspace_id',true) AND a.conversation_id=p_conversation AND app.current_role() IS NOT NULL ORDER BY a.created_at DESC,a.id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.sdr_approve_turn(p_turn text,p_message text,p_text text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.sdr_turn;v app.calendar_reservation;v_lead text;
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
  UPDATE app.calendar_reservation r SET sdr_presence='pending' FROM app.sdr_meeting_reminder m
   WHERE m.workspace_id=ws AND m.id=t.reminder_id AND r.workspace_id=ws AND r.id=m.reservation_id AND r.sdr_presence IS DISTINCT FROM 'confirmed';
 END IF;
 -- The lead's answer about the meeting, as the approved reply states it.
 IF t.proposal->>'kind'='presence' AND t.proposal->>'value' IN('confirmed','reschedule') THEN
  UPDATE app.calendar_reservation SET sdr_presence=t.proposal->>'value' WHERE workspace_id=ws AND id=t.proposal->>'reservationId' AND state='accepted' RETURNING * INTO v;
  IF v.id IS NOT NULL THEN
   IF v.sdr_presence='reschedule' THEN UPDATE app.sdr_meeting_reminder SET state='dropped' WHERE workspace_id=ws AND reservation_id=v.id AND state IN('due','drafted');END IF;
   SELECT cc.lead_id INTO v_lead FROM app.channel_conversation cc WHERE cc.workspace_id=ws AND cc.id=t.conversation_id;
   IF v_lead IS NOT NULL THEN
    UPDATE app.lead SET payload=jsonb_set(payload,'{sdrProfile}',coalesce(payload->'sdrProfile','{}'::jsonb)||jsonb_build_object('status',
     CASE WHEN v.sdr_presence='confirmed' THEN 'Presença confirmada para '||to_char(v.start_at AT TIME ZONE v.timezone,'DD/MM HH24:MI') ELSE 'Pediu para remarcar' END,
     'updatedAt',clock_timestamp())) WHERE workspace_id=ws AND id=v_lead;
   END IF;
  END IF;
 END IF;
END $$;

-- Meetings the lead asked to reschedule that are still on the calendar (the new one exists, the old cancel failed or a person booked by hand).
CREATE FUNCTION app.sdr_rescheduled_view(p_conversation text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'start',to_char(r.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timezone',r.timezone,'revision',r.revision) ORDER BY r.start_at),'[]'::jsonb)
 FROM app.sdr_business_action a JOIN app.calendar_reservation r ON r.workspace_id=a.workspace_id AND r.request_id=a.request_id
 WHERE a.workspace_id=current_setting('app.workspace_id',true) AND a.conversation_id=p_conversation AND app.current_role() IS NOT NULL
  AND r.state='accepted' AND r.sdr_presence='reschedule' AND r.end_at>clock_timestamp()
  AND r.id IS DISTINCT FROM (app.sdr_booking_view(p_conversation)->>'id')
$$;
REVOKE ALL ON FUNCTION app.sdr_rescheduled_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sdr_rescheduled_view(text) TO cadence_app;
