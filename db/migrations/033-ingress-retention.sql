CREATE FUNCTION app.prune_channel_ingest_metadata(p_now timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE affected integer;
BEGIN
 IF p_now IS NULL OR NOT isfinite(p_now) OR p_now>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'INVALID_RETENTION_CLOCK';END IF;
 WITH expired AS (
  SELECT id FROM app.channel_received_event
  WHERE received_at<p_now-interval '90 days' AND metadata_pruned_at IS NULL
  ORDER BY id LIMIT 1000 FOR UPDATE SKIP LOCKED
 ) UPDATE app.channel_received_event e SET body_hash=NULL,event_metadata=NULL,metadata_pruned_at=p_now,
  time_lookup_state=CASE WHEN time_lookup_state IN('pending','running') THEN 'done' ELSE time_lookup_state END,
  lookup_token=NULL,lookup_until=NULL,retry_at=NULL
  FROM expired WHERE e.id=expired.id;
 GET DIAGNOSTICS affected=ROW_COUNT;RETURN affected;
END $$;
REVOKE ALL ON FUNCTION app.prune_channel_ingest_metadata(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.prune_channel_ingest_metadata(timestamptz) TO cadence_ingress;
