-- A long pause is read back in 15-minute windows instead of being declared a gap, and a reconnect resumes
-- from the last read point (up to 7 days back) instead of skipping what arrived while the number was paused.
CREATE OR REPLACE FUNCTION app.claim_openwa_recovery(p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app.openwa_connection;r app.openwa_recovery;token text;
BEGIN
 IF p_now IS NULL OR NOT isfinite(p_now) THEN RAISE EXCEPTION 'INVALID_OPENWA_CLOCK';END IF;
 INSERT INTO app.openwa_recovery(workspace_id,connection_id,revision,checkpoint,next_at)
 SELECT o.workspace_id,o.connection_id,o.revision,o.messages_since-interval '2 seconds',p_now FROM app.openwa_connection o WHERE o.phase='ready' AND o.desired_state='connected' AND NOT o.automation_paused AND NOT EXISTS(SELECT 1 FROM app.openwa_recovery existing WHERE existing.workspace_id=o.workspace_id AND existing.connection_id=o.connection_id) ORDER BY o.created_at LIMIT 5 ON CONFLICT DO NOTHING;
 SELECT o.* INTO q FROM app.openwa_connection o JOIN app.channel_connection c ON c.workspace_id=o.workspace_id AND c.id=o.connection_id JOIN app.openwa_recovery job ON job.workspace_id=o.workspace_id AND job.connection_id=o.connection_id
 WHERE o.phase='ready' AND o.desired_state='connected' AND NOT o.automation_paused AND o.revision=c.revision AND c.credentials_verified AND c.state='ready' AND job.next_at<=p_now AND(job.lease_until IS NULL OR job.lease_until<clock_timestamp())
 AND EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=o.workspace_id AND m."userId"=o.requested_by AND m.role IN('owner','admin'))
 ORDER BY job.next_at,o.connection_id LIMIT 1 FOR UPDATE OF job SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;token:=gen_random_uuid()::text;
 UPDATE app.openwa_recovery SET checkpoint=CASE WHEN revision<>q.revision THEN GREATEST(checkpoint,p_now-interval '7 days') ELSE checkpoint END,window_until=CASE WHEN revision<>q.revision THEN LEAST(p_now,GREATEST(checkpoint,p_now-interval '7 days')+interval '15 minutes') ELSE COALESCE(window_until,LEAST(p_now,checkpoint+interval '15 minutes')) END,cursor=CASE WHEN revision<>q.revision THEN NULL ELSE cursor END,pages=CASE WHEN revision<>q.revision THEN 0 ELSE pages END,revision=q.revision,lease_token=token,lease_until=clock_timestamp()+interval '60 seconds',fence=fence+1 WHERE workspace_id=q.workspace_id AND connection_id=q.connection_id RETURNING * INTO r;
 RETURN jsonb_build_object('workspaceId',q.workspace_id,'connectionId',q.connection_id,'revision',q.revision,'token',token,'fence',r.fence);
END $$;

