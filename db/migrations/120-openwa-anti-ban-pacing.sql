-- Anti-ban pacing for OpenWA numbers (research of 14/11/2026: OpenWA risk guide, Baileys community).
-- Replies inside the 24 h window get their own budget; outreach keeps 20/day and 5 new contacts, now spaced and paused when few people answer.
ALTER TABLE app.openwa_platform_limits ADD COLUMN reply_cap integer NOT NULL DEFAULT 60 CHECK(reply_cap BETWEEN 0 AND 100000),
 ADD COLUMN active_gap_min_seconds integer NOT NULL DEFAULT 120 CHECK(active_gap_min_seconds BETWEEN 0 AND 86400),
 ADD COLUMN active_gap_max_seconds integer NOT NULL DEFAULT 480 CHECK(active_gap_max_seconds BETWEEN 0 AND 86400),
 ADD COLUMN reply_rate_min_sample integer NOT NULL DEFAULT 10 CHECK(reply_rate_min_sample>=1),
 ADD COLUMN reply_rate_floor numeric NOT NULL DEFAULT 0.30 CHECK(reply_rate_floor BETWEEN 0 AND 1),
 ADD CONSTRAINT openwa_gap_order CHECK(active_gap_max_seconds>=active_gap_min_seconds);
ALTER TABLE app.openwa_usage_reservation ADD COLUMN reply boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION app.reserve_openwa_usage(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.message_outbox;s app.channel_sender;c app.channel_connection;caps app.openwa_platform_limits;period date;used integer;cold integer;new_person boolean;code text;last_inbound timestamptz;existing app.openwa_usage_reservation;is_reply boolean;last_active timestamptz;gap integer;sample integer;replied integer;
BEGIN
 IF p_now IS NULL OR NOT isfinite(p_now) THEN RAISE EXCEPTION 'INVALID_OPENWA_CLOCK';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=p_ws AND message_id=p_message AND lease_token=p_token AND fence=p_fence AND lease_until>clock_timestamp() AND state IN('pending','dispatching') FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM app.message_dispatch_attempt a WHERE a.workspace_id=p_ws AND a.id=p_attempt AND a.message_id=p_message AND a.lease_token=p_token AND a.fence=p_fence AND a.state IN('prepared','dispatching')) THEN RETURN jsonb_build_object('allowed',false,'code','STALE_LEASE');END IF;
 SELECT * INTO s FROM app.channel_sender WHERE workspace_id=p_ws AND id=o.sender_id FOR UPDATE;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=p_ws AND id=o.connection_id;
 IF s.provider<>'openwa' OR c.provider<>'openwa' OR s.connection_id<>c.id OR NOT s.ready OR c.state<>'ready' OR NOT EXISTS(SELECT 1 FROM app.openwa_connection q WHERE q.workspace_id=p_ws AND q.connection_id=c.id AND q.phase='ready' AND q.desired_state='connected' AND NOT q.automation_paused) THEN RETURN jsonb_build_object('allowed',false,'code','CONNECTION_CHANGED');END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=p_ws AND m."userId"=o.actor_id AND(m.role IN('owner','admin') OR(o.authority_kind='member' AND m.role='operator'))) THEN RETURN jsonb_build_object('allowed',false,'code','AUTHORITY_REVOKED');END IF;
 IF EXISTS(SELECT 1 FROM app.contact_suppression x WHERE x.workspace_id=p_ws AND x.identity_id=o.identity_id AND x.scope IN('all',o.prepared_send->>'purpose')) THEN RETURN jsonb_build_object('allowed',false,'code','CONTACT_SUPPRESSED');END IF;
 SELECT max(v.last_inbound_at) INTO last_inbound FROM app.channel_conversation v WHERE v.workspace_id=p_ws AND v.sender_id=s.id AND v.identity_id=o.identity_id;
 IF NOT COALESCE(o.prepared_send->>'purpose'='service' AND last_inbound<=p_now AND last_inbound>p_now-interval '24 hours',false) AND NOT EXISTS(SELECT 1 FROM app.consent_evidence ce WHERE ce.workspace_id=p_ws AND ce.identity_id=o.identity_id AND ce.purpose=o.prepared_send->>'purpose' AND ce.occurred_at<=p_now) THEN RETURN jsonb_build_object('allowed',false,'code','OPT_IN_REQUIRED');END IF;
 SELECT * INTO caps FROM app.openwa_platform_limits WHERE singleton;
 IF s.daily_limit IS NULL OR s.daily_limit>caps.daily_cap OR s.new_conversation_limit IS NULL OR s.new_conversation_limit>caps.new_conversation_cap OR s.new_conversation_limit>s.daily_limit THEN RETURN jsonb_build_object('allowed',false,'code','OPENWA_PLATFORM_LIMIT');END IF;
 SELECT * INTO existing FROM app.openwa_usage_reservation WHERE workspace_id=p_ws AND attempt_id=p_attempt;
 IF FOUND THEN RETURN jsonb_build_object('allowed',NOT existing.released,'code',CASE WHEN existing.released THEN 'STALE_LEASE' ELSE NULL END);END IF;
 period:=(p_now AT TIME ZONE 'America/Sao_Paulo')::date;
 new_person:=NOT EXISTS(SELECT 1 FROM app.channel_message m WHERE m.workspace_id=p_ws AND m.sender_id=s.id AND m.identity_id=o.identity_id AND m.id<>p_message AND(m.direction='inbound' OR m.state IN('accepted','delivered','read')));
 -- A reply to someone who wrote in the last 24 h is the safest traffic: it has its own budget and never competes with outreach.
 is_reply:=NOT new_person AND COALESCE(o.prepared_send->>'purpose'='service' AND last_inbound<=p_now AND last_inbound>p_now-interval '24 hours',false);
 IF is_reply THEN
  SELECT count(*) INTO used FROM app.openwa_usage_reservation WHERE workspace_id=p_ws AND sender_id=s.id AND period_date=period AND reply AND NOT released;
  IF used>=caps.reply_cap THEN RETURN jsonb_build_object('allowed',false,'code','OPENWA_REPLY_LIMIT');END IF;
 ELSE
  SELECT count(*) INTO used FROM app.openwa_usage_reservation WHERE workspace_id=p_ws AND sender_id=s.id AND period_date=period AND NOT reply AND NOT released;
  IF used>=LEAST(s.daily_limit,caps.daily_cap) THEN RETURN jsonb_build_object('allowed',false,'code','OPENWA_DAILY_LIMIT');END IF;
  -- Outreach in bursts looks automated: each send waits a per-message random gap after the previous one.
  SELECT max(created_at) INTO last_active FROM app.openwa_usage_reservation WHERE workspace_id=p_ws AND sender_id=s.id AND NOT reply AND NOT released;
  gap:=caps.active_gap_min_seconds+(abs(hashtext(p_message)::bigint)%(caps.active_gap_max_seconds-caps.active_gap_min_seconds+1))::integer;
  IF gap>0 AND last_active IS NOT NULL AND p_now<last_active+make_interval(secs=>gap) THEN RETURN jsonb_build_object('allowed',false,'code','OPENWA_PACING','retryAt',last_active+make_interval(secs=>gap));END IF;
  -- Few answers to outreach is the signal WhatsApp acts on: below the floor, outreach waits for the next day.
  SELECT count(*),count(*) FILTER(WHERE EXISTS(SELECT 1 FROM app.channel_message m WHERE m.workspace_id=p_ws AND m.sender_id=s.id AND m.identity_id=f.identity_id AND m.direction='inbound' AND m.created_at>f.first_at)) INTO sample,replied
   FROM(SELECT identity_id,min(created_at) AS first_at FROM app.openwa_usage_reservation WHERE workspace_id=p_ws AND sender_id=s.id AND NOT reply AND consumed AND created_at>p_now-interval '7 days' GROUP BY identity_id HAVING min(created_at)<=p_now-interval '24 hours') f;
  IF sample>=caps.reply_rate_min_sample AND replied<sample*caps.reply_rate_floor THEN RETURN jsonb_build_object('allowed',false,'code','OPENWA_LOW_REPLY_RATE');END IF;
  IF new_person AND NOT EXISTS(SELECT 1 FROM app.openwa_usage_reservation WHERE workspace_id=p_ws AND sender_id=s.id AND identity_id=o.identity_id AND period_date=period AND new_contact AND NOT released) THEN
   SELECT count(DISTINCT identity_id) INTO cold FROM app.openwa_usage_reservation WHERE workspace_id=p_ws AND sender_id=s.id AND period_date=period AND new_contact AND NOT released;
   IF cold>=LEAST(s.new_conversation_limit,caps.new_conversation_cap) THEN RETURN jsonb_build_object('allowed',false,'code','OPENWA_NEW_CONVERSATION_LIMIT');END IF;
  END IF;
 END IF;
 INSERT INTO app.openwa_usage_reservation(workspace_id,attempt_id,message_id,sender_id,identity_id,period_date,new_contact,reply) VALUES(p_ws,p_attempt,p_message,s.id,o.identity_id,period,new_person,is_reply);
 RETURN jsonb_build_object('allowed',true);
END $$;
CREATE OR REPLACE FUNCTION app.begin_message_dispatch_pre_retirement(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_guard jsonb,p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE data jsonb;o app.message_outbox;reservation jsonb;result jsonb;code text;had_reservation boolean;
BEGIN
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=p_ws AND message_id=p_message AND lease_token=p_token AND fence=p_fence AND lease_until>clock_timestamp() AND state='pending' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'code','STALE_LEASE');END IF;
 data:=app.message_dispatch_scope(p_ws,p_message);
 IF data->'connection'->>'provider' IS DISTINCT FROM 'openwa' THEN RETURN app.begin_message_dispatch_pre_openwa(p_ws,p_message,p_attempt,p_token,p_fence,p_guard,p_now);END IF;
 IF p_now IS NULL OR NOT isfinite(p_now) THEN RAISE EXCEPTION 'INVALID_OPENWA_CLOCK';END IF;
 IF data ? 'blocker' THEN code:=data->>'blocker';
 ELSIF data->'guard' IS DISTINCT FROM p_guard THEN code:='STATE_CHANGED';
 ELSIF o.prepared_send->'content'->>'kind' IS DISTINCT FROM 'text' OR length(o.prepared_send->'content'->>'text') NOT BETWEEN 1 AND 4096 OR o.prepared_send->'content'->>'text' ~ '\{\{[^{}]*\}\}' THEN code:='OPENWA_TEXT_REQUIRED';
 ELSIF data->'identity'->>'scope' IS DISTINCT FROM 'openwa:'||o.connection_id OR data->'sender'->>'identity_scope' IS DISTINCT FROM 'openwa:'||o.connection_id
  OR data->'identity'->>'scope' IS DISTINCT FROM o.prepared_send->'identity'->>'scope' OR data->'identity'->>'external_id' IS DISTINCT FROM o.prepared_send->'identity'->>'externalId'
  OR data->'identity'->'phone' IS DISTINCT FROM o.prepared_send->'identity'->'phone' OR data->'identity'->>'external_id' !~ '^[0-9]{6,20}@(c\.us|s\.whatsapp\.net|lid)$'
  OR data->'sender'->>'connection_id' IS DISTINCT FROM o.connection_id OR o.prepared_send->>'connectionId' IS DISTINCT FROM o.connection_id OR o.prepared_send->>'senderId' IS DISTINCT FROM o.sender_id THEN code:='CONTACT_CHANGED';END IF;
 IF code IS NOT NULL THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,code);RETURN jsonb_build_object('allowed',false,'code',code);END IF;
 SELECT EXISTS(SELECT 1 FROM app.openwa_usage_reservation WHERE workspace_id=p_ws AND attempt_id=p_attempt) INTO had_reservation;
 reservation:=app.reserve_openwa_usage(p_ws,p_message,p_attempt,p_token,p_fence,p_now);
 IF NOT COALESCE((reservation->>'allowed')::boolean,false) THEN
  code:=reservation->>'code';
  IF code IN('OPENWA_DAILY_LIMIT','OPENWA_NEW_CONVERSATION_LIMIT','OPENWA_REPLY_LIMIT','OPENWA_LOW_REPLY_RATE','OPENWA_PACING') THEN
   UPDATE app.message_outbox SET next_at=COALESCE((reservation->>'retryAt')::timestamptz,(((p_now AT TIME ZONE 'America/Sao_Paulo')::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')),lease_until=NULL,blocked_code=code WHERE workspace_id=p_ws AND message_id=p_message;
  ELSE PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,code);END IF;RETURN reservation;
 END IF;
 result:=app.begin_message_dispatch_pre_openwa(p_ws,p_message,p_attempt,p_token,p_fence,p_guard,p_now);
 -- A refused final gate never establishes POST intent. Remove only this newly created hold.
 IF NOT COALESCE((result->>'allowed')::boolean,false) AND NOT had_reservation THEN DELETE FROM app.openwa_usage_reservation WHERE workspace_id=p_ws AND attempt_id=p_attempt AND NOT consumed;END IF;
 RETURN result;
END $$;
