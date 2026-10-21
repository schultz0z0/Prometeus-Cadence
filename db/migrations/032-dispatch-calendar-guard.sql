CREATE OR REPLACE FUNCTION app.begin_message_dispatch(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_guard jsonb,p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.message_outbox;scope_data jsonb;s app.channel_sender;lim app.messaging_limits;used_ws bigint;used_sender bigint;period date;next_day timestamptz;window_open boolean;purpose text;content jsonb;gap_min integer;gap_max integer;pub jsonb;
BEGIN
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 SELECT m.* INTO o FROM app.message_outbox m WHERE m.workspace_id=p_ws AND m.message_id=p_message AND m.lease_token=p_token AND m.fence=p_fence AND m.lease_until>clock_timestamp() AND m.state='pending' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM app.message_dispatch_attempt WHERE workspace_id=p_ws AND id=p_attempt AND message_id=p_message AND fence=p_fence AND lease_token=p_token AND state='prepared') THEN RETURN jsonb_build_object('allowed',false,'code','STALE_LEASE');END IF;
 scope_data:=app.message_dispatch_scope(p_ws,p_message);
 IF scope_data ? 'blocker' THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,scope_data->>'blocker');RETURN jsonb_build_object('allowed',false,'code',scope_data->>'blocker');END IF;
 IF scope_data->'guard' IS DISTINCT FROM p_guard THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'STATE_CHANGED');RETURN jsonb_build_object('allowed',false,'code','STATE_CHANGED');END IF;
 IF o.publication_id IS NOT NULL AND (scope_data->'publication'->>'state'<>'active' OR scope_data->'enrollment'->>'state'<>'active' OR (scope_data->'enrollment'->>'next_step')::integer<>o.step_index OR scope_data->'lead' IS DISTINCT FROM scope_data->'publication'->'snapshot'->'recipientFacts'->(scope_data->'enrollment'->>'lead_id') OR (scope_data->>'contextVersion')::bigint<>(scope_data->'publication'->'snapshot'->>'contextVersion')::bigint OR (scope_data->>'aiRevision')::bigint<>(scope_data->'publication'->'snapshot'->>'aiRouteRevision')::bigint) THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'PUBLICATION_CHANGED');RETURN jsonb_build_object('allowed',false,'code','PUBLICATION_CHANGED');END IF;
 IF scope_data->'connection'->>'state'<>'ready' OR NOT (scope_data->'connection'->>'credentials_verified')::boolean OR (scope_data->'connection'->>'revision')::bigint<>(o.prepared_send->>'connectionRevision')::bigint OR NOT(scope_data->'sender'->>'ready')::boolean OR (scope_data->'sender'->>'revision')::bigint<>(o.proof->>'senderRevision')::bigint OR ((scope_data->'connection'->>'token_expires_at')::timestamptz IS NOT NULL AND (scope_data->'connection'->>'token_expires_at')::timestamptz<=p_now) THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'CONNECTION_CHANGED');RETURN jsonb_build_object('allowed',false,'code','CONNECTION_CHANGED');END IF;
 IF o.publication_id IS NOT NULL AND (NOT (scope_data->'publication'->'snapshot'->'cadence'->'settings'->'weekdays' @> to_jsonb(ARRAY[extract(dow FROM p_now AT TIME ZONE (scope_data->'publication'->'snapshot'->'cadence'->'settings'->>'timezone'))::integer])) OR to_char(p_now AT TIME ZONE (scope_data->'publication'->'snapshot'->'cadence'->'settings'->>'timezone'),'HH24:MI')<(scope_data->'publication'->'snapshot'->'cadence'->'settings'->>'sendTime')) THEN
  UPDATE app.message_outbox SET next_at=p_now+interval '1 minute',lease_until=NULL,blocked_code='SCHEDULE_WAIT' WHERE workspace_id=p_ws AND message_id=p_message;RETURN jsonb_build_object('allowed',false,'code','SCHEDULE_WAIT');
 END IF;
 purpose:=o.prepared_send->>'purpose';content:=o.prepared_send->'content';window_open:=(scope_data->'identity'->>'last_inbound_at')::timestamptz<=p_now AND (scope_data->'identity'->>'last_inbound_at')::timestamptz+interval '24 hours'>p_now;
 IF jsonb_array_length(scope_data->'suppressions')>0 OR ((purpose<>'service' OR NOT COALESCE(window_open,false)) AND jsonb_array_length(scope_data->'consents')=0) OR (content->>'kind'='text' AND NOT COALESCE(window_open,false)) OR (content->>'kind'='template' AND (scope_data->'template' IS NULL OR scope_data->'template'='null'::jsonb OR scope_data->'template'->>'status'<>'approved' OR (scope_data->'template'->>'revision')::bigint<>(content->>'templateRevision')::bigint)) THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'POLICY_CHANGED');RETURN jsonb_build_object('allowed',false,'code','POLICY_CHANGED');END IF;
 SELECT * INTO s FROM app.channel_sender WHERE workspace_id=p_ws AND id=o.sender_id FOR UPDATE;
 SELECT * INTO lim FROM app.messaging_limits WHERE workspace_id=p_ws FOR UPDATE;
 IF lim.workspace_id IS NULL OR s.daily_limit IS NULL THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'EXPLICIT_LIMITS_REQUIRED');RETURN jsonb_build_object('allowed',false,'code','EXPLICIT_LIMITS_REQUIRED');END IF;
 period:=(p_now AT TIME ZONE lim.timezone)::date;
 SELECT COALESCE(sum(units*CASE WHEN event='release' THEN -1 ELSE 1 END),0),COALESCE(sum(units*CASE WHEN event='release' THEN -1 ELSE 1 END) FILTER(WHERE sender_id=s.id),0) INTO used_ws,used_sender FROM app.message_usage_ledger WHERE workspace_id=p_ws AND period_date=period;
 IF used_ws>=lim.workspace_daily_limit OR used_sender>=s.daily_limit THEN
  next_day:=((period+1)::timestamp AT TIME ZONE lim.timezone);UPDATE app.message_outbox SET next_at=next_day,lease_until=NULL,blocked_code='DAILY_LIMIT' WHERE workspace_id=p_ws AND message_id=p_message;RETURN jsonb_build_object('allowed',false,'code','DAILY_LIMIT');
 END IF;
 IF s.next_send_at>p_now THEN UPDATE app.message_outbox SET next_at=s.next_send_at,lease_until=NULL,blocked_code='SENDER_INTERVAL' WHERE workspace_id=p_ws AND message_id=p_message;RETURN jsonb_build_object('allowed',false,'code','SENDER_INTERVAL');END IF;
 pub:=scope_data->'publication'->'snapshot';gap_min:=GREATEST(lim.min_interval_seconds,COALESCE((pub->'cadence'->'settings'->'whatsappIntervalSeconds'->>0)::integer,lim.min_interval_seconds));gap_max:=GREATEST(gap_min,lim.max_interval_seconds,COALESCE((pub->'cadence'->'settings'->'whatsappIntervalSeconds'->>1)::integer,lim.max_interval_seconds));
 UPDATE app.channel_sender SET next_send_at=p_now+make_interval(secs=>gap_min+floor(random()*(gap_max-gap_min+1))) WHERE workspace_id=p_ws AND id=s.id;
 INSERT INTO app.message_usage_ledger(workspace_id,sender_id,message_id,attempt_id,event,operation_id,period_date) VALUES(p_ws,s.id,p_message,p_attempt,'reserve',p_attempt,period);
 UPDATE app.message_dispatch_attempt SET state='dispatching',started_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_attempt;
 UPDATE app.message_outbox SET state='dispatching',attempt_count=attempt_count+1,blocked_code=NULL WHERE workspace_id=p_ws AND message_id=p_message;
 UPDATE app.channel_message SET state='dispatching',error_code=NULL WHERE workspace_id=p_ws AND id=p_message;
 RETURN jsonb_build_object('allowed',true);
END $$;
CREATE FUNCTION app.defer_message_dispatch(p_ws text,p_message text,p_token text,p_fence bigint,p_next timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 IF p_next IS NULL OR p_next<=clock_timestamp() THEN RAISE EXCEPTION 'INVALID_DEFER_TIME';END IF;
 UPDATE app.message_outbox SET next_at=p_next,lease_until=NULL,blocked_code='SCHEDULE_WAIT' WHERE workspace_id=p_ws AND message_id=p_message AND lease_token=p_token AND fence=p_fence AND state='pending';
END $$;
REVOKE ALL ON FUNCTION app.defer_message_dispatch(text,text,text,bigint,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.defer_message_dispatch(text,text,text,bigint,timestamptz) TO cadence_dispatcher;
