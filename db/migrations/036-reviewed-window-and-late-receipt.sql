-- Keep service windows per actual sender conversation, including delayed Twilio timestamps.
ALTER TABLE app.channel_conversation ADD COLUMN last_inbound_at timestamptz;
UPDATE app.channel_conversation v SET last_inbound_at=x.at FROM (
 SELECT workspace_id,conversation_id,max(occurred_at) AS at FROM app.channel_message
 WHERE direction='inbound' AND occurred_at<=clock_timestamp() GROUP BY workspace_id,conversation_id
) x WHERE v.workspace_id=x.workspace_id AND v.id=x.conversation_id;
CREATE FUNCTION app.channel_conversation_window_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.direction='inbound' AND NEW.occurred_at IS NOT NULL AND NEW.occurred_at<=clock_timestamp() THEN
  UPDATE app.channel_conversation SET last_inbound_at=GREATEST(last_inbound_at,NEW.occurred_at)
  WHERE workspace_id=NEW.workspace_id AND id=NEW.conversation_id AND sender_id=NEW.sender_id AND identity_id=NEW.identity_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.channel_conversation_window_trigger() FROM PUBLIC;
CREATE TRIGGER channel_conversation_window AFTER INSERT OR UPDATE OF occurred_at ON app.channel_message
FOR EACH ROW EXECUTE FUNCTION app.channel_conversation_window_trigger();
CREATE OR REPLACE FUNCTION app.message_dispatch_scope(p_ws text,p_message text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.message_outbox;c app.channel_connection;s app.channel_sender;i app.channel_identity;p app.cadence_publication;e app.cadence_enrollment;lim app.messaging_limits;actor_role text;lead jsonb;tpl jsonb;consents jsonb;suppressions jsonb;context_version bigint;ai_revision bigint;product jsonb;guard jsonb;last_inbound timestamptz;
BEGIN
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=p_ws AND message_id=p_message;IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT role INTO actor_role FROM auth.member WHERE "organizationId"=p_ws AND "userId"=o.actor_id;
 IF actor_role IS NULL OR (o.authority_kind='admin' AND actor_role NOT IN('owner','admin')) THEN RETURN jsonb_build_object('blocker','AUTHORITY_REVOKED');END IF;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=p_ws AND id=o.connection_id;
 SELECT * INTO s FROM app.channel_sender WHERE workspace_id=p_ws AND id=o.sender_id;
 SELECT * INTO i FROM app.channel_identity WHERE workspace_id=p_ws AND id=o.identity_id;
 SELECT last_inbound_at INTO last_inbound FROM app.channel_conversation WHERE workspace_id=p_ws AND sender_id=o.sender_id AND identity_id=o.identity_id;
 SELECT * INTO lim FROM app.messaging_limits WHERE workspace_id=p_ws;
 IF o.publication_id IS NOT NULL THEN
  SELECT * INTO p FROM app.cadence_publication WHERE workspace_id=p_ws AND id=o.publication_id;
  SELECT * INTO e FROM app.cadence_enrollment WHERE workspace_id=p_ws AND id=o.enrollment_id;
  SELECT payload INTO lead FROM app.lead WHERE workspace_id=p_ws AND id=e.lead_id;
  IF p.snapshot->>'productId' IS NOT NULL THEN SELECT jsonb_build_object('version',approved->'version','archived',archived) INTO product FROM app.product_profile WHERE workspace_id=p_ws AND id=p.snapshot->>'productId';END IF;
 ELSIF o.proof->>'leadId' IS NOT NULL THEN SELECT payload INTO lead FROM app.lead WHERE workspace_id=p_ws AND id=o.proof->>'leadId';END IF;
 IF o.prepared_send->'content'->>'kind'='template' THEN SELECT payload INTO tpl FROM app.channel_remote_template WHERE workspace_id=p_ws AND connection_id=c.id AND id=o.prepared_send->'content'->>'templateId';END IF;
 SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]') INTO consents FROM app.consent_evidence WHERE workspace_id=p_ws AND identity_id=i.id AND purpose=o.prepared_send->>'purpose' AND occurred_at<=clock_timestamp();
 SELECT COALESCE(jsonb_agg(scope ORDER BY scope),'[]') INTO suppressions FROM app.contact_suppression WHERE workspace_id=p_ws AND identity_id=i.id AND scope IN('all',o.prepared_send->>'purpose');
 SELECT COALESCE(max(version),0) INTO context_version FROM app.context_version WHERE workspace_id=p_ws AND payload->>'approvedAt' IS NOT NULL AND pg_input_is_valid(payload->>'approvedAt','timestamptz');
 SELECT COALESCE((SELECT revision FROM app.ai_policy WHERE workspace_id=p_ws),0) INTO ai_revision;
 guard:=jsonb_build_object('actorRole',actor_role,'lastInboundAt',last_inbound,'connection',jsonb_build_object('revision',c.revision,'state',c.state,'verified',c.credentials_verified,'expires',c.token_expires_at),
  'sender',jsonb_build_object('revision',s.revision,'ready',s.ready,'dailyLimit',s.daily_limit),'identity',to_jsonb(i),'limits',to_jsonb(lim),'template',tpl,'consents',consents,'suppressions',suppressions,'lead',lead,
  'publication',jsonb_build_object('id',p.id,'state',p.state,'revision',p.revision),'enrollment',jsonb_build_object('id',e.id,'state',e.state,'step',e.next_step,'epoch',e.authorized_reply_epoch),'contextVersion',context_version,'aiRevision',ai_revision,'product',product);
 RETURN jsonb_build_object('lastInboundAt',last_inbound,'outbox',to_jsonb(o),'connection',to_jsonb(c),'sender',to_jsonb(s),'identity',to_jsonb(i),'limits',to_jsonb(lim),'publication',to_jsonb(p),'enrollment',to_jsonb(e),'template',tpl,'lead',lead,'consents',consents,'suppressions',suppressions,'contextVersion',context_version,'aiRevision',ai_revision,'product',product,'guard',guard);
END $$;

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
 purpose:=o.prepared_send->>'purpose';content:=o.prepared_send->'content';window_open:=(scope_data->>'lastInboundAt')::timestamptz<=p_now AND (scope_data->>'lastInboundAt')::timestamptz+interval '24 hours'>p_now;
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

-- A signed positive receipt supersedes administrator-attested non-acceptance.
CREATE OR REPLACE FUNCTION app.channel_trace_receipt_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.message_dispatch_attempt;o app.message_outbox;trace text;scope text;
BEGIN
 IF NEW.kind<>'status' THEN RETURN NEW;END IF;trace:=NEW.event_metadata->>'traceId';IF trace IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO a FROM app.message_dispatch_attempt WHERE workspace_id=NEW.workspace_id AND id=trace AND (state IN('dispatching','uncertain','accepted') OR (state='not_accepted' AND outcome->>'code'='MANUALLY_RECONCILED_NOT_ACCEPTED'));IF NOT FOUND THEN RETURN NEW;END IF;
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=NEW.workspace_id AND message_id=a.message_id AND connection_id=NEW.connection_id;IF NOT FOUND THEN RETURN NEW;END IF;
 IF o.prepared_send->'identity'->>'scope' NOT IN('meta:'||(NEW.event_metadata->>'accountId'),'twilio:'||(NEW.event_metadata->>'accountId')) THEN RETURN NEW;END IF;
 PERFORM app.record_message_dispatch_receipt(o.workspace_id,o.message_id,a.id,a.lease_token,a.fence,jsonb_build_object('attemptId',a.id,'outcome',jsonb_build_object('kind','accepted','remoteId',NEW.remote_id,'acceptedAt',COALESCE(a.started_at,NEW.received_at)),'costUsd',NULL,'costKind','unknown'));
 RETURN NEW;
END $$;
