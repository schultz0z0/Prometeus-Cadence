ALTER TABLE app.email_message ADD COLUMN metadata_pruned_at timestamptz;
CREATE FUNCTION app.prune_mail_metadata(p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempts integer; messages integer;
BEGIN
 IF p_now IS NULL OR NOT isfinite(p_now) OR p_now>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'INVALID_RETENTION_CLOCK';END IF;
 WITH expired AS(SELECT workspace_id,id FROM app.email_oauth_attempt WHERE expires_at<p_now ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED)
 DELETE FROM app.email_oauth_attempt a USING expired e WHERE a.workspace_id=e.workspace_id AND a.id=e.id;
 GET DIAGNOSTICS attempts=ROW_COUNT;
 WITH expired AS(SELECT m.workspace_id,m.message_id FROM app.email_message m JOIN app.channel_message c ON c.workspace_id=m.workspace_id AND c.id=m.message_id
 WHERE c.created_at<p_now-interval '90 days' AND m.metadata_pruned_at IS NULL ORDER BY c.created_at,m.message_id LIMIT 1000 FOR UPDATE OF m SKIP LOCKED)
 UPDATE app.email_message m SET classification_evidence=m.classification_evidence-'headers'-'deliveryStatus',metadata_pruned_at=p_now
 FROM expired e WHERE m.workspace_id=e.workspace_id AND m.message_id=e.message_id;
 GET DIAGNOSTICS messages=ROW_COUNT;
 RETURN jsonb_build_object('oauthAttempts',attempts,'messages',messages);
END $$;
REVOKE ALL ON FUNCTION app.prune_mail_metadata(timestamptz) FROM PUBLIC,cadence_app,cadence_ingress;
GRANT EXECUTE ON FUNCTION app.prune_mail_metadata(timestamptz) TO cadence_dispatcher;
