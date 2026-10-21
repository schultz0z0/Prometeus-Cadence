ALTER TABLE app.channel_sender ADD COLUMN next_send_at timestamptz;
ALTER TABLE app.cadence_enrollment ADD COLUMN schedule_pending boolean NOT NULL DEFAULT false;
ALTER TABLE app.messaging_limits ADD COLUMN min_interval_seconds integer NOT NULL DEFAULT 60 CHECK(min_interval_seconds BETWEEN 1 AND 86400);
ALTER TABLE app.messaging_limits ADD COLUMN max_interval_seconds integer NOT NULL DEFAULT 180 CHECK(max_interval_seconds BETWEEN min_interval_seconds AND 86400);

CREATE FUNCTION app.message_dispatch_scope(p_ws text,p_message text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.message_outbox;c app.channel_connection;s app.channel_sender;i app.channel_identity;p app.cadence_publication;e app.cadence_enrollment;lim app.messaging_limits;actor_role text;lead jsonb;tpl jsonb;consents jsonb;suppressions jsonb;context_version bigint;ai_revision bigint;product jsonb;guard jsonb;
BEGIN
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=p_ws AND message_id=p_message;IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT role INTO actor_role FROM auth.member WHERE "organizationId"=p_ws AND "userId"=o.actor_id;
 IF actor_role IS NULL OR (o.authority_kind='admin' AND actor_role NOT IN('owner','admin')) THEN RETURN jsonb_build_object('blocker','AUTHORITY_REVOKED');END IF;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=p_ws AND id=o.connection_id;
 SELECT * INTO s FROM app.channel_sender WHERE workspace_id=p_ws AND id=o.sender_id;
 SELECT * INTO i FROM app.channel_identity WHERE workspace_id=p_ws AND id=o.identity_id;
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
 guard:=jsonb_build_object('actorRole',actor_role,'connection',jsonb_build_object('revision',c.revision,'state',c.state,'verified',c.credentials_verified,'expires',c.token_expires_at),
  'sender',jsonb_build_object('revision',s.revision,'ready',s.ready,'dailyLimit',s.daily_limit),'identity',to_jsonb(i),'limits',to_jsonb(lim),'template',tpl,'consents',consents,'suppressions',suppressions,'lead',lead,
  'publication',jsonb_build_object('id',p.id,'state',p.state,'revision',p.revision),'enrollment',jsonb_build_object('id',e.id,'state',e.state,'step',e.next_step,'epoch',e.authorized_reply_epoch),'contextVersion',context_version,'aiRevision',ai_revision,'product',product);
 RETURN jsonb_build_object('outbox',to_jsonb(o),'connection',to_jsonb(c),'sender',to_jsonb(s),'identity',to_jsonb(i),'limits',to_jsonb(lim),'publication',to_jsonb(p),'enrollment',to_jsonb(e),'template',tpl,'lead',lead,'consents',consents,'suppressions',suppressions,'contextVersion',context_version,'aiRevision',ai_revision,'product',product,'guard',guard);
END $$;

CREATE FUNCTION app.claim_message_dispatch(p_now timestamptz,p_workspace text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate record;o app.message_outbox;a app.message_dispatch_attempt;token text;attempt_id text;
BEGIN
 FOR candidate IN SELECT workspace_id,message_id FROM app.message_outbox WHERE (p_workspace IS NULL OR workspace_id=p_workspace) AND ((state='pending' AND next_at<=p_now AND (lease_until IS NULL OR lease_until<clock_timestamp())) OR (state='dispatching' AND lease_until<clock_timestamp())) ORDER BY next_at,message_id LIMIT 100 LOOP
  PERFORM 1 FROM app.workspace_meta WHERE workspace_id=candidate.workspace_id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;
  SELECT * INTO o FROM app.message_outbox WHERE workspace_id=candidate.workspace_id AND message_id=candidate.message_id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;
  IF o.state='dispatching' AND o.lease_until<clock_timestamp() THEN
   UPDATE app.message_outbox SET state='uncertain',blocked_code='DISPATCH_RECEIPT_MISSING' WHERE workspace_id=o.workspace_id AND message_id=o.message_id;
   UPDATE app.channel_message SET state='uncertain' WHERE workspace_id=o.workspace_id AND id=o.message_id AND state NOT IN('delivered','read');
   UPDATE app.message_dispatch_attempt SET state='uncertain' WHERE workspace_id=o.workspace_id AND message_id=o.message_id AND state='dispatching';CONTINUE;
  END IF;
  IF o.state<>'pending' OR o.next_at>p_now OR o.lease_until>clock_timestamp() THEN CONTINUE;END IF;
  IF o.attempt_count>=3 THEN UPDATE app.message_outbox SET state='failed',blocked_code='RETRY_EXHAUSTED' WHERE workspace_id=o.workspace_id AND message_id=o.message_id;CONTINUE;END IF;
  token:=gen_random_uuid()::text;attempt_id:=gen_random_uuid()::text;
  UPDATE app.message_outbox SET fence=fence+1,lease_token=token,lease_until=clock_timestamp()+interval '60 seconds' WHERE workspace_id=o.workspace_id AND message_id=o.message_id RETURNING * INTO o;
  SELECT * INTO a FROM app.message_dispatch_attempt WHERE workspace_id=o.workspace_id AND message_id=o.message_id AND attempt_number=o.attempt_count+1;
  IF FOUND AND a.state='prepared' THEN
   attempt_id:=a.id;UPDATE app.message_dispatch_attempt SET fence=o.fence,lease_token=token WHERE workspace_id=o.workspace_id AND id=a.id;
  ELSE INSERT INTO app.message_dispatch_attempt(workspace_id,id,message_id,attempt_number,fence,lease_token,state) VALUES(o.workspace_id,attempt_id,o.message_id,o.attempt_count+1,o.fence,token,'prepared');END IF;
  RETURN jsonb_build_object('workspaceId',o.workspace_id,'messageId',o.message_id,'attemptId',attempt_id,'token',token,'fence',o.fence,'expiresAt',o.lease_until);
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION app.heartbeat_message_dispatch(p_ws text,p_message text,p_token text,p_fence bigint) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE until_at timestamptz;
BEGIN
 UPDATE app.message_outbox SET lease_until=clock_timestamp()+interval '60 seconds' WHERE workspace_id=p_ws AND message_id=p_message AND lease_token=p_token AND fence=p_fence AND lease_until>clock_timestamp() AND state IN('pending','dispatching') RETURNING lease_until INTO until_at;RETURN until_at;
END $$;
CREATE FUNCTION app.read_message_dispatch(p_ws text,p_message text,p_token text,p_fence bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state jsonb;o app.message_outbox;envelope jsonb;
BEGIN
 SELECT m.* INTO o FROM app.message_outbox m WHERE m.workspace_id=p_ws AND m.message_id=p_message AND m.lease_token=p_token AND m.fence=p_fence AND m.lease_until>clock_timestamp() AND m.state='pending';IF NOT FOUND THEN RETURN NULL;END IF;
 state:=app.message_dispatch_scope(p_ws,p_message);IF state ? 'blocker' THEN RETURN state;END IF;
 IF o.publication_id IS NOT NULL AND (state->'publication'->>'state'<>'active' OR state->'enrollment'->>'state'<>'active') THEN RETURN jsonb_build_object('blocker','PUBLICATION_CHANGED');END IF;
 IF state->'connection'->>'state'<>'ready' OR (state->'connection'->>'revision')::bigint<>(o.prepared_send->>'connectionRevision')::bigint THEN RETURN jsonb_build_object('blocker','CONNECTION_CHANGED');END IF;
 SELECT cr.envelope INTO envelope FROM app.channel_credential cr WHERE workspace_id=p_ws AND connection_id=o.connection_id AND revision=(o.prepared_send->>'connectionRevision')::bigint;
 RETURN state||jsonb_build_object('credentialEnvelope',envelope);
END $$;
CREATE FUNCTION app.block_message_dispatch(p_ws text,p_message text,p_token text,p_fence bigint,p_code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 UPDATE app.message_outbox SET state='blocked',blocked_code=left(p_code,100),lease_until=NULL WHERE workspace_id=p_ws AND message_id=p_message AND lease_token=p_token AND fence=p_fence AND state='pending';
 IF FOUND THEN UPDATE app.channel_message SET state='blocked',error_code=left(p_code,100) WHERE workspace_id=p_ws AND id=p_message;END IF;
END $$;

CREATE FUNCTION app.begin_message_dispatch(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_guard jsonb,p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.message_outbox;state jsonb;s app.channel_sender;lim app.messaging_limits;used_ws bigint;used_sender bigint;period date;next_day timestamptz;window_open boolean;purpose text;content jsonb;gap_min integer;gap_max integer;pub jsonb;
BEGIN
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 SELECT m.* INTO o FROM app.message_outbox m WHERE m.workspace_id=p_ws AND m.message_id=p_message AND m.lease_token=p_token AND m.fence=p_fence AND m.lease_until>clock_timestamp() AND m.state='pending' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM app.message_dispatch_attempt WHERE workspace_id=p_ws AND id=p_attempt AND message_id=p_message AND fence=p_fence AND lease_token=p_token AND state='prepared') THEN RETURN jsonb_build_object('allowed',false,'code','STALE_LEASE');END IF;
 state:=app.message_dispatch_scope(p_ws,p_message);
 IF state ? 'blocker' THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,state->>'blocker');RETURN jsonb_build_object('allowed',false,'code',state->>'blocker');END IF;
 IF state->'guard' IS DISTINCT FROM p_guard THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'STATE_CHANGED');RETURN jsonb_build_object('allowed',false,'code','STATE_CHANGED');END IF;
 IF o.publication_id IS NOT NULL AND (state->'publication'->>'state'<>'active' OR state->'enrollment'->>'state'<>'active' OR (state->'enrollment'->>'next_step')::integer<>o.step_index OR state->'lead' IS DISTINCT FROM state->'publication'->'snapshot'->'recipientFacts'->(state->'enrollment'->>'lead_id') OR (state->>'contextVersion')::bigint<>(state->'publication'->'snapshot'->>'contextVersion')::bigint OR (state->>'aiRevision')::bigint<>(state->'publication'->'snapshot'->>'aiRouteRevision')::bigint) THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'PUBLICATION_CHANGED');RETURN jsonb_build_object('allowed',false,'code','PUBLICATION_CHANGED');END IF;
 IF state->'connection'->>'state'<>'ready' OR NOT (state->'connection'->>'credentials_verified')::boolean OR (state->'connection'->>'revision')::bigint<>(o.prepared_send->>'connectionRevision')::bigint OR NOT(state->'sender'->>'ready')::boolean OR (state->'sender'->>'revision')::bigint<>(o.proof->>'senderRevision')::bigint OR ((state->'connection'->>'token_expires_at')::timestamptz IS NOT NULL AND (state->'connection'->>'token_expires_at')::timestamptz<=p_now) THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'CONNECTION_CHANGED');RETURN jsonb_build_object('allowed',false,'code','CONNECTION_CHANGED');END IF;
 purpose:=o.prepared_send->>'purpose';content:=o.prepared_send->'content';window_open:=(state->'identity'->>'last_inbound_at')::timestamptz<=p_now AND (state->'identity'->>'last_inbound_at')::timestamptz+interval '24 hours'>p_now;
 IF jsonb_array_length(state->'suppressions')>0 OR ((purpose<>'service' OR NOT COALESCE(window_open,false)) AND jsonb_array_length(state->'consents')=0) OR (content->>'kind'='text' AND NOT COALESCE(window_open,false)) OR (content->>'kind'='template' AND (state->'template' IS NULL OR state->'template'='null'::jsonb OR state->'template'->>'status'<>'approved' OR (state->'template'->>'revision')::bigint<>(content->>'templateRevision')::bigint)) THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'POLICY_CHANGED');RETURN jsonb_build_object('allowed',false,'code','POLICY_CHANGED');END IF;
 SELECT * INTO s FROM app.channel_sender WHERE workspace_id=p_ws AND id=o.sender_id FOR UPDATE;
 SELECT * INTO lim FROM app.messaging_limits WHERE workspace_id=p_ws FOR UPDATE;
 IF lim.workspace_id IS NULL OR s.daily_limit IS NULL THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'EXPLICIT_LIMITS_REQUIRED');RETURN jsonb_build_object('allowed',false,'code','EXPLICIT_LIMITS_REQUIRED');END IF;
 period:=(p_now AT TIME ZONE lim.timezone)::date;
 SELECT COALESCE(sum(units*CASE WHEN event='release' THEN -1 ELSE 1 END),0),COALESCE(sum(units*CASE WHEN event='release' THEN -1 ELSE 1 END) FILTER(WHERE sender_id=s.id),0) INTO used_ws,used_sender FROM app.message_usage_ledger WHERE workspace_id=p_ws AND period_date=period;
 IF used_ws>=lim.workspace_daily_limit OR used_sender>=s.daily_limit THEN
  next_day:=((period+1)::timestamp AT TIME ZONE lim.timezone);UPDATE app.message_outbox SET next_at=next_day,lease_until=NULL,blocked_code='DAILY_LIMIT' WHERE workspace_id=p_ws AND message_id=p_message;RETURN jsonb_build_object('allowed',false,'code','DAILY_LIMIT');
 END IF;
 IF s.next_send_at>p_now THEN UPDATE app.message_outbox SET next_at=s.next_send_at,lease_until=NULL,blocked_code='SENDER_INTERVAL' WHERE workspace_id=p_ws AND message_id=p_message;RETURN jsonb_build_object('allowed',false,'code','SENDER_INTERVAL');END IF;
 pub:=state->'publication'->'snapshot';gap_min:=GREATEST(lim.min_interval_seconds,COALESCE((pub->'cadence'->'settings'->'whatsappIntervalSeconds'->>0)::integer,lim.min_interval_seconds));gap_max:=GREATEST(gap_min,lim.max_interval_seconds,COALESCE((pub->'cadence'->'settings'->'whatsappIntervalSeconds'->>1)::integer,lim.max_interval_seconds));
 UPDATE app.channel_sender SET next_send_at=p_now+make_interval(secs=>gap_min+floor(random()*(gap_max-gap_min+1))) WHERE workspace_id=p_ws AND id=s.id;
 INSERT INTO app.message_usage_ledger(workspace_id,sender_id,message_id,attempt_id,event,operation_id,period_date) VALUES(p_ws,s.id,p_message,p_attempt,'reserve',p_attempt,period);
 UPDATE app.message_dispatch_attempt SET state='dispatching',started_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_attempt;
 UPDATE app.message_outbox SET state='dispatching',attempt_count=attempt_count+1,blocked_code=NULL WHERE workspace_id=p_ws AND message_id=p_message;
 UPDATE app.channel_message SET state='dispatching',error_code=NULL WHERE workspace_id=p_ws AND id=p_message;
 RETURN jsonb_build_object('allowed',true);
END $$;

CREATE FUNCTION app.record_message_dispatch_receipt(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_receipt jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.message_outbox;a app.message_dispatch_attempt;result_outcome jsonb;reservation app.message_usage_ledger;code text;retry_ms numeric;at timestamptz;
BEGIN
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=p_ws AND message_id=p_message FOR UPDATE;
 SELECT * INTO a FROM app.message_dispatch_attempt WHERE workspace_id=p_ws AND id=p_attempt AND message_id=p_message AND lease_token=p_token AND fence=p_fence FOR UPDATE;
 IF NOT FOUND OR a.state NOT IN('dispatching','uncertain','accepted','not_accepted') OR pg_column_size(p_receipt)>65536 THEN RAISE EXCEPTION 'INVALID_RECEIPT';END IF;
 result_outcome:=p_receipt->'outcome';IF result_outcome->>'kind' NOT IN('accepted','not_accepted','uncertain') OR p_receipt->>'attemptId'<>p_attempt THEN RAISE EXCEPTION 'INVALID_RECEIPT';END IF;
 IF a.state='accepted' THEN IF result_outcome->>'kind'='accepted' AND a.remote_id=result_outcome->>'remoteId' THEN RETURN true;ELSIF result_outcome->>'kind'='uncertain' THEN RETURN true;ELSE RAISE EXCEPTION 'RECEIPT_CONFLICT';END IF;END IF;
 IF a.state='not_accepted' THEN IF a.outcome=result_outcome THEN RETURN true;ELSE RAISE EXCEPTION 'RECEIPT_CONFLICT';END IF;END IF;
 SELECT * INTO reservation FROM app.message_usage_ledger WHERE workspace_id=p_ws AND operation_id=p_attempt AND event='reserve';IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_REQUIRED';END IF;
 IF result_outcome->>'kind'='accepted' THEN
  IF length(result_outcome->>'remoteId') NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'INVALID_REMOTE_ID';END IF;at:=(result_outcome->>'acceptedAt')::timestamptz;
  UPDATE app.message_dispatch_attempt SET state='accepted',remote_id=result_outcome->>'remoteId',outcome=result_outcome,completed_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_attempt;
  UPDATE app.message_outbox SET state='accepted',remote_id=result_outcome->>'remoteId',accepted_at=at,lease_until=NULL WHERE workspace_id=p_ws AND message_id=p_message;
  UPDATE app.channel_message SET state='accepted',remote_id=result_outcome->>'remoteId',accepted_at=at WHERE workspace_id=p_ws AND id=p_message;
  INSERT INTO app.message_usage_ledger(workspace_id,sender_id,message_id,attempt_id,event,operation_id,period_date,cost_usd,cost_kind) VALUES(p_ws,o.sender_id,p_message,p_attempt,'consume',p_attempt,reservation.period_date,NULL,'unknown') ON CONFLICT DO NOTHING;
  INSERT INTO app.message_usage_ledger(workspace_id,sender_id,message_id,attempt_id,event,operation_id,period_date) VALUES(p_ws,o.sender_id,p_message,p_attempt,'release',p_attempt,reservation.period_date) ON CONFLICT DO NOTHING;
  PERFORM app.apply_channel_status(o.connection_id,result_outcome->>'remoteId');
  IF o.enrollment_id IS NOT NULL THEN
   UPDATE app.cadence_enrollment en SET last_accepted_at=at,next_step=en.next_step+1,schedule_pending=(en.next_step+1<jsonb_array_length(pub.snapshot->'cadence'->'steps')),next_at='infinity',state=CASE WHEN en.next_step+1>=jsonb_array_length(pub.snapshot->'cadence'->'steps') THEN 'completed' ELSE 'active' END
    FROM app.cadence_publication pub WHERE en.workspace_id=p_ws AND en.id=o.enrollment_id AND en.state='active' AND en.next_step=o.step_index AND pub.workspace_id=en.workspace_id AND pub.id=en.publication_id AND pub.state='active' AND EXISTS(SELECT 1 FROM auth.member WHERE "organizationId"=p_ws AND "userId"=o.actor_id AND role IN('owner','admin'));
  END IF;
 ELSIF result_outcome->>'kind'='not_accepted' THEN
  retry_ms:=GREATEST(30000,COALESCE((result_outcome->>'retryAfterMs')::numeric,0));code:=left(result_outcome->>'code',100);
  UPDATE app.message_dispatch_attempt SET state='not_accepted',outcome=result_outcome,completed_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_attempt;
  UPDATE app.message_outbox SET state=CASE WHEN COALESCE((result_outcome->>'retryable')::boolean,false) AND attempt_count<3 AND retry_ms<=31536000000 THEN 'pending' ELSE 'failed' END,next_at=GREATEST(clock_timestamp(),(p_receipt->>'recordedAt')::timestamptz)+make_interval(secs=>LEAST(retry_ms,31536000000)::double precision/1000),blocked_code=code,lease_until=NULL WHERE workspace_id=p_ws AND message_id=p_message RETURNING state INTO code;
  UPDATE app.channel_message SET state=CASE WHEN code='pending' THEN 'pending' ELSE 'failed' END,error_code=left(result_outcome->>'code',100) WHERE workspace_id=p_ws AND id=p_message;
  INSERT INTO app.message_usage_ledger(workspace_id,sender_id,message_id,attempt_id,event,operation_id,period_date) VALUES(p_ws,o.sender_id,p_message,p_attempt,'release',p_attempt,reservation.period_date) ON CONFLICT DO NOTHING;
 ELSE
  UPDATE app.message_dispatch_attempt SET state='uncertain',outcome=result_outcome,completed_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_attempt;
  UPDATE app.message_outbox SET state='uncertain',blocked_code=left(result_outcome->>'code',100),lease_until=NULL WHERE workspace_id=p_ws AND message_id=p_message;
  UPDATE app.channel_message SET state='uncertain',error_code=left(result_outcome->>'code',100) WHERE workspace_id=p_ws AND id=p_message AND state NOT IN('delivered','read');
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION app.channel_trace_receipt_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.message_dispatch_attempt;o app.message_outbox;trace text;scope text;
BEGIN
 IF NEW.kind<>'status' THEN RETURN NEW;END IF;trace:=NEW.event_metadata->>'traceId';IF trace IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO a FROM app.message_dispatch_attempt WHERE workspace_id=NEW.workspace_id AND id=trace AND state IN('dispatching','uncertain','accepted');IF NOT FOUND THEN RETURN NEW;END IF;
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=NEW.workspace_id AND message_id=a.message_id AND connection_id=NEW.connection_id;IF NOT FOUND THEN RETURN NEW;END IF;
 IF o.prepared_send->'identity'->>'scope' NOT IN('meta:'||(NEW.event_metadata->>'accountId'),'twilio:'||(NEW.event_metadata->>'accountId')) THEN RETURN NEW;END IF;
 PERFORM app.record_message_dispatch_receipt(o.workspace_id,o.message_id,a.id,a.lease_token,a.fence,jsonb_build_object('attemptId',a.id,'outcome',jsonb_build_object('kind','accepted','remoteId',NEW.remote_id,'acceptedAt',COALESCE(a.started_at,NEW.received_at)),'costUsd',NULL,'costKind','unknown'));
 RETURN NEW;
END $$;
CREATE TRIGGER channel_trace_receipt AFTER INSERT ON app.channel_received_event FOR EACH ROW EXECUTE FUNCTION app.channel_trace_receipt_trigger();

CREATE FUNCTION app.list_enrollment_schedules(p_limit integer,p_workspace text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('workspaceId',x.workspace_id,'enrollmentId',x.id,'nextStep',x.next_step,'acceptedAt',x.last_accepted_at,'cadence',x.snapshot->'cadence')),'[]') FROM (
  SELECT e.*,p.snapshot FROM app.cadence_enrollment e JOIN app.cadence_publication p ON p.workspace_id=e.workspace_id AND p.id=e.publication_id WHERE e.state='active' AND e.schedule_pending AND p.state='active' AND (p_workspace IS NULL OR e.workspace_id=p_workspace) ORDER BY e.last_accepted_at,e.id LIMIT LEAST(GREATEST(p_limit,0),100)
 ) x
$$;
CREATE FUNCTION app.finish_enrollment_schedule(p_ws text,p_id text,p_step integer,p_accepted timestamptz,p_next timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e app.cadence_enrollment;p app.cadence_publication;step jsonb;zone text;minimum timestamp;
BEGIN
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 SELECT * INTO e FROM app.cadence_enrollment WHERE workspace_id=p_ws AND id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT e.schedule_pending OR e.state<>'active' OR e.next_step<>p_step OR e.last_accepted_at<>p_accepted THEN RETURN;END IF;
 SELECT * INTO p FROM app.cadence_publication WHERE workspace_id=p_ws AND id=e.publication_id;
 IF p.state<>'active' OR NOT EXISTS(SELECT 1 FROM auth.member WHERE "organizationId"=p_ws AND "userId"=p.created_by AND role IN('owner','admin')) THEN UPDATE app.cadence_enrollment SET state='blocked',schedule_pending=false,stop_reason='AUTHORITY_REVOKED' WHERE workspace_id=p_ws AND id=p_id;RETURN;END IF;
 step:=p.snapshot->'cadence'->'steps'->p_step;zone:=p.snapshot->'cadence'->'settings'->>'timezone';minimum:=(p_accepted AT TIME ZONE zone)+make_interval(days=>(step->>'delayDays')::integer);
 IF p_next IS NULL OR (p_next AT TIME ZONE zone)<minimum THEN RAISE EXCEPTION 'INVALID_SCHEDULE';END IF;
 UPDATE app.cadence_enrollment SET next_at=p_next,schedule_pending=false WHERE workspace_id=p_ws AND id=p_id;
END $$;

REVOKE ALL ON FUNCTION app.message_dispatch_scope(text,text),app.claim_message_dispatch(timestamptz,text),app.heartbeat_message_dispatch(text,text,text,bigint),app.read_message_dispatch(text,text,text,bigint),app.block_message_dispatch(text,text,text,bigint,text),app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz),app.record_message_dispatch_receipt(text,text,text,text,bigint,jsonb),app.channel_trace_receipt_trigger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_message_dispatch(timestamptz,text),app.heartbeat_message_dispatch(text,text,text,bigint),app.read_message_dispatch(text,text,text,bigint),app.block_message_dispatch(text,text,text,bigint,text),app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz),app.record_message_dispatch_receipt(text,text,text,text,bigint,jsonb) TO cadence_dispatcher;
REVOKE ALL ON FUNCTION app.list_enrollment_schedules(integer,text),app.finish_enrollment_schedule(text,text,integer,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_enrollment_schedules(integer,text),app.finish_enrollment_schedule(text,text,integer,timestamptz,timestamptz) TO cadence_dispatcher;
