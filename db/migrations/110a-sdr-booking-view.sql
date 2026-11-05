-- 07B.3: the reservation's request id is not readable by the app role; the conversation reads its booking through this.
CREATE FUNCTION app.sdr_booking_view(p_conversation text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',r.id,'start',to_char(r.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'end',to_char(r.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'state',r.state,'revision',r.revision)
 FROM app.sdr_business_action a JOIN app.calendar_reservation r ON r.workspace_id=a.workspace_id AND r.request_id=a.request_id
 WHERE a.workspace_id=current_setting('app.workspace_id',true) AND a.conversation_id=p_conversation AND app.current_role() IS NOT NULL ORDER BY a.created_at DESC,a.id LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.sdr_booking_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sdr_booking_view(text) TO cadence_app;
