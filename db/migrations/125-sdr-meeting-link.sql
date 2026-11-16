-- SDR meetings (16/11/2026): a booking made from the agent invites the lead and gets a Google Meet link, kept with the reservation.
ALTER TABLE app.calendar_reservation ADD COLUMN meet_url text CHECK(meet_url ~ '^https://\S+$' AND length(meet_url)<=500);
CREATE FUNCTION app.calendar_set_meet(p_id text,p_url text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.calendar_actor();
 UPDATE app.calendar_reservation SET meet_url=p_url WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_id;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_booking_view(p_conversation text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',r.id,'start',to_char(r.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'end',to_char(r.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'state',r.state,'revision',r.revision,'timezone',r.timezone,'meetUrl',r.meet_url)
 FROM app.sdr_business_action a JOIN app.calendar_reservation r ON r.workspace_id=a.workspace_id AND r.request_id=a.request_id
 WHERE a.workspace_id=current_setting('app.workspace_id',true) AND a.conversation_id=p_conversation AND app.current_role() IS NOT NULL ORDER BY a.created_at DESC,a.id LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.calendar_set_meet(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.calendar_set_meet(text,text) TO cadence_app;
