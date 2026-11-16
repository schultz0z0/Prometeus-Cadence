-- 16/11/2026: meeting reminders of the Agente SDR. A meeting the agent books gets app-written reminders
-- (day before, 2h before) that the worker turns into drafts waiting for approval. Managed WhatsApp only:
-- a sender that needs a service window (Meta) would need an approved template.
CREATE TABLE app.sdr_meeting_reminder(
 workspace_id text NOT NULL,id text NOT NULL DEFAULT gen_random_uuid()::text,conversation_id text NOT NULL,reservation_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN('day-before','two-hours')),due_at timestamptz NOT NULL,deadline_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'due' CHECK(state IN('due','drafted','sent','rejected','dropped')),turn_id text,evidence_id text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,reservation_id,kind),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES app.channel_conversation(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,reservation_id) REFERENCES app.calendar_reservation(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX sdr_meeting_reminder_due ON app.sdr_meeting_reminder(due_at) WHERE state='due';
ALTER TABLE app.sdr_meeting_reminder ENABLE ROW LEVEL SECURITY;ALTER TABLE app.sdr_meeting_reminder FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.sdr_meeting_reminder FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing;
CREATE POLICY ws_read ON app.sdr_meeting_reminder FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT ON app.sdr_meeting_reminder TO cadence_app;
-- Presence is written only when a person approves: pending (a reminder went out), confirmed, reschedule.
ALTER TABLE app.calendar_reservation ADD COLUMN sdr_presence text CHECK(sdr_presence IN('pending','confirmed','reschedule'));

CREATE FUNCTION app.sdr_reminders_schedule(p_conversation text,p_reservation text,p_times jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);cc app.channel_conversation;r app.calendar_reservation;msg app.channel_message;ev text;x jsonb;n integer:=0;
BEGIN
 PERFORM app.sdr_role(false);
 SELECT * INTO cc FROM app.channel_conversation WHERE workspace_id=ws AND id=p_conversation;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 SELECT * INTO r FROM app.calendar_reservation WHERE workspace_id=ws AND id=p_reservation;
 IF NOT FOUND OR r.state<>'accepted' THEN RETURN 0;END IF;
 IF NOT EXISTS(SELECT 1 FROM app.sdr_agent_for_connection(cc.connection_id) a WHERE a.config->>'objective'='meetings' AND coalesce((a.config->>'meetingReminders')::boolean,true)) THEN RETURN 0;END IF;
 IF NOT EXISTS(SELECT 1 FROM app.channel_sender s WHERE s.workspace_id=ws AND s.id=cc.sender_id AND s.capabilities->>'requiresServiceWindow'='false') THEN RETURN 0;END IF;
 -- Reminders of an earlier meeting of this conversation stop: only the current meeting is reminded.
 UPDATE app.sdr_meeting_reminder SET state='dropped' WHERE workspace_id=ws AND conversation_id=p_conversation AND reservation_id<>p_reservation AND state IN('due','drafted');
 IF jsonb_array_length(coalesce(p_times,'[]'))=0 THEN RETURN 0;END IF;
 -- The lead chose this time in the conversation: that message is the evidence for reminding them of it.
 SELECT * INTO msg FROM app.channel_message WHERE workspace_id=ws AND conversation_id=p_conversation AND direction='inbound' AND text IS NOT NULL ORDER BY message_order DESC LIMIT 1;
 IF NOT FOUND THEN RETURN 0;END IF;
 ev:=gen_random_uuid()::text;
 INSERT INTO app.consent_evidence(workspace_id,id,identity_id,purpose,source,occurred_at,evidence,actor_id)
  VALUES(ws,ev,cc.identity_id,'service','sdr-meeting-reminder',msg.occurred_at,left(msg.text,500),current_setting('app.user_id',true));
 FOR x IN SELECT * FROM jsonb_array_elements(p_times) LOOP
  INSERT INTO app.sdr_meeting_reminder(workspace_id,conversation_id,reservation_id,kind,due_at,deadline_at,evidence_id)
   VALUES(ws,p_conversation,p_reservation,x->>'kind',(x->>'at')::timestamptz,r.start_at-interval '30 minutes',ev) ON CONFLICT DO NOTHING;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION app.sdr_reminders_schedule(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sdr_reminders_schedule(text,text,jsonb) TO cadence_app;
-- The agent's hours for a conversation, so the app computes reminder times as the agent sees its day.
CREATE FUNCTION app.sdr_conversation_hours(p_conversation text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT a.config->'hours' FROM app.channel_conversation cc CROSS JOIN LATERAL app.sdr_agent_for_connection(cc.connection_id) a
 WHERE cc.workspace_id=current_setting('app.workspace_id',true) AND cc.id=p_conversation AND app.current_role() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION app.sdr_conversation_hours(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sdr_conversation_hours(text) TO cadence_app;
