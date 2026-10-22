CREATE FUNCTION app.sync_mail_refresh(p_ws text,p_id text,p_token text,p_fence bigint,p_revision bigint,p_action text,p_envelope jsonb,p_expires timestamptz,p_error text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE scope_data jsonb;box app.email_mailbox;
BEGIN
 scope_data:=app.read_mail_sync(p_ws,p_id,p_token,p_fence);
 IF scope_data->'connection'->>'provider'<>'gmail' OR(scope_data->'connection'->>'revision')::bigint<>p_revision THEN RAISE EXCEPTION 'MAIL_CHANGED';END IF;
 IF p_action='claim' THEN
  UPDATE app.email_mailbox SET refresh_token_lock=p_token,refresh_lock_until=clock_timestamp()+interval '45 seconds' WHERE workspace_id=p_ws AND id=p_id AND(refresh_lock_until IS NULL OR refresh_lock_until<clock_timestamp());RETURN FOUND;
 END IF;
 SELECT * INTO box FROM app.email_mailbox WHERE workspace_id=p_ws AND id=p_id FOR UPDATE;
 IF box.refresh_token_lock IS DISTINCT FROM p_token OR box.refresh_lock_until<clock_timestamp() THEN RETURN false;END IF;
 IF p_action='commit' THEN
  IF p_envelope IS NULL OR pg_column_size(p_envelope)>131072 THEN RAISE EXCEPTION 'INVALID_CREDENTIAL';END IF;
  UPDATE app.channel_credential SET envelope=p_envelope WHERE workspace_id=p_ws AND connection_id=p_id AND revision=p_revision;
  UPDATE app.channel_connection SET token_expires_at=p_expires WHERE workspace_id=p_ws AND id=p_id AND revision=p_revision;
 ELSIF p_action='failure' AND p_error='invalid_grant' THEN
  UPDATE app.email_mailbox SET state='authorization_required',send_verified=false,read_verified=false,last_error='GMAIL_RECONNECT_REQUIRED' WHERE workspace_id=p_ws AND id=p_id;
  UPDATE app.channel_connection SET credentials_verified=false,state='attention' WHERE workspace_id=p_ws AND id=p_id;
  UPDATE app.channel_sender SET ready=false WHERE workspace_id=p_ws AND connection_id=p_id;
 ELSIF p_action<>'failure' THEN RAISE EXCEPTION 'INVALID_REFRESH_ACTION';END IF;
 UPDATE app.email_mailbox SET refresh_token_lock=NULL,refresh_lock_until=NULL WHERE workspace_id=p_ws AND id=p_id;RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.sync_mail_refresh(text,text,text,bigint,bigint,text,jsonb,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sync_mail_refresh(text,text,text,bigint,bigint,text,jsonb,timestamptz,text) TO cadence_dispatcher;
