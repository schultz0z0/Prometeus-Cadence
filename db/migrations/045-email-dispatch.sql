-- Extend the existing fenced context; a caller cannot obtain credentials without a live lease.
ALTER FUNCTION app.message_dispatch_scope(text,text) RENAME TO message_dispatch_scope_legacy;
CREATE FUNCTION app.message_dispatch_scope(p_ws text,p_message text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE data jsonb;box app.email_mailbox;lim app.messaging_channel_limits;
BEGIN
 data:=app.message_dispatch_scope_legacy(p_ws,p_message);IF data IS NULL OR data ? 'blocker' THEN RETURN data;END IF;
 IF data->'connection'->>'channel'='EMAIL' THEN
  SELECT * INTO box FROM app.email_mailbox WHERE workspace_id=p_ws AND id=data->'connection'->>'id';
  SELECT * INTO lim FROM app.messaging_channel_limits WHERE workspace_id=p_ws AND channel='EMAIL';
  data:=data||jsonb_build_object('mailbox',to_jsonb(box),'channelLimits',to_jsonb(lim));
  data:=jsonb_set(data,'{guard}',data->'guard'||jsonb_build_object('mailbox',to_jsonb(box),'channelLimits',to_jsonb(lim)));
 END IF;RETURN data;
END $$;
REVOKE ALL ON FUNCTION app.message_dispatch_scope(text,text),app.message_dispatch_scope_legacy(text,text) FROM PUBLIC,cadence_app,cadence_dispatcher;
-- Keep the shared reservation/receipt implementation. Add channel barriers before it.
ALTER FUNCTION app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) RENAME TO begin_message_dispatch_legacy;
CREATE FUNCTION app.begin_message_dispatch(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_guard jsonb,p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE data jsonb;o app.message_outbox;box app.email_mailbox;cl app.messaging_channel_limits;lim app.messaging_limits;s app.channel_sender;period date;used bigint;next_day timestamptz;result jsonb;code text;
BEGIN
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=p_ws AND message_id=p_message AND lease_token=p_token AND fence=p_fence AND lease_until>clock_timestamp() AND state='pending' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'code','STALE_LEASE');END IF;
 IF o.prepared_send->>'channel'='EMAIL' THEN
  data:=app.message_dispatch_scope(p_ws,p_message);
  IF data->'guard' IS DISTINCT FROM p_guard THEN code:='STATE_CHANGED';END IF;
  SELECT * INTO cl FROM app.messaging_channel_limits WHERE workspace_id=p_ws AND channel='EMAIL' FOR UPDATE;
  SELECT * INTO s FROM app.channel_sender WHERE workspace_id=p_ws AND id=o.sender_id FOR UPDATE;
  SELECT * INTO box FROM app.email_mailbox WHERE workspace_id=p_ws AND id=o.connection_id FOR UPDATE;
  SELECT * INTO lim FROM app.messaging_limits WHERE workspace_id=p_ws FOR UPDATE;
  IF box.id IS NULL OR box.state<>'ready' OR NOT box.proof_verified OR NOT box.send_verified OR NOT box.read_verified OR box.bounce_paused OR box.sync_gap THEN code:='MAILBOX_UNAVAILABLE';END IF;
  IF o.prepared_send->>'purpose'='campaign' AND (box.sync_state<>'ready' OR box.last_synced_at IS NULL OR box.last_synced_at>p_now OR box.last_synced_at<p_now-interval '300 seconds') THEN code:='EMAIL_SYNC_REQUIRED';END IF;
  IF cl.workspace_id IS NULL OR lim.workspace_id IS NULL OR s.daily_limit IS NULL THEN code:='EXPLICIT_LIMITS_REQUIRED';END IF;
  IF data->'identity'->>'scope'<>'email' OR data->'identity'->>'external_id'<>o.prepared_send->>'to' OR s.address<>o.prepared_send->>'address' OR box.signature<>o.prepared_send->'content'->>'signature' THEN code:='CONTACT_OR_SIGNATURE_CHANGED';END IF;
  IF jsonb_array_length(data->'suppressions')>0 OR (o.prepared_send->>'purpose'<>'service' AND jsonb_array_length(data->'consents')=0) OR (o.prepared_send->>'purpose'='service' AND data->>'lastInboundAt' IS NULL) THEN code:='EMAIL_POLICY_CHANGED';END IF;
  IF code IS NOT NULL THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,code);RETURN jsonb_build_object('allowed',false,'code',code);END IF;
  period:=(p_now AT TIME ZONE lim.timezone)::date;
  SELECT COALESCE(sum(l.units*CASE WHEN l.event='release' THEN -1 ELSE 1 END),0) INTO used FROM app.message_usage_ledger l JOIN app.channel_sender cs ON cs.workspace_id=l.workspace_id AND cs.id=l.sender_id WHERE l.workspace_id=p_ws AND l.period_date=period AND cs.channel='EMAIL';
  IF used>=cl.daily_limit THEN next_day:=((period+1)::timestamp AT TIME ZONE lim.timezone);UPDATE app.message_outbox SET next_at=next_day,lease_until=NULL,blocked_code='EMAIL_DAILY_LIMIT' WHERE workspace_id=p_ws AND message_id=p_message;RETURN jsonb_build_object('allowed',false,'code','EMAIL_DAILY_LIMIT');END IF;
 END IF;
 result:=app.begin_message_dispatch_legacy(p_ws,p_message,p_attempt,p_token,p_fence,p_guard,p_now);
 IF o.prepared_send->>'channel'='EMAIL' AND (result->>'allowed')::boolean THEN
  UPDATE app.channel_sender SET next_send_at=GREATEST(next_send_at,p_now+make_interval(secs=>cl.min_interval_seconds+floor(random()*(cl.max_interval_seconds-cl.min_interval_seconds+1)))) WHERE workspace_id=p_ws AND id=o.sender_id;
 END IF;RETURN result;
END $$;
-- Email service messages require inbound evidence, not a WhatsApp 24h window.
DO $$ DECLARE definition text;needle text:='((purpose<>''service'' OR NOT COALESCE(window_open,false)) AND jsonb_array_length(scope_data->''consents'')=0)';BEGIN
 SELECT pg_get_functiondef('app.begin_message_dispatch_legacy(text,text,text,text,bigint,jsonb,timestamptz)'::regprocedure) INTO definition;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'DISPATCH_POLICY_UPGRADE_REQUIRED';END IF;
 EXECUTE replace(definition,needle,'((purpose<>''service'' OR (o.prepared_send->>''channel'' IS DISTINCT FROM ''EMAIL'' AND NOT COALESCE(window_open,false))) AND jsonb_array_length(scope_data->''consents'')=0)');
END $$;
REVOKE ALL ON FUNCTION app.begin_message_dispatch_legacy(text,text,text,text,bigint,jsonb,timestamptz),app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) FROM PUBLIC,cadence_app,cadence_dispatcher;
GRANT EXECUTE ON FUNCTION app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) TO cadence_dispatcher;
