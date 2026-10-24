-- Preserve the email proof and Meta policy gates; only OpenWA text has no service-window requirement.
DO $$ DECLARE definition text;needle text:='content->>''kind''=''text'' AND';BEGIN
 SELECT pg_get_functiondef('app.begin_message_dispatch_legacy(text,text,text,text,bigint,jsonb,timestamptz)'::regprocedure) INTO definition;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'OPENWA_DISPATCH_UPGRADE_REQUIRED';END IF;
 EXECUTE replace(definition,needle,needle||' scope_data->''connection''->>''provider'' IS DISTINCT FROM ''openwa'' AND');
END $$;
ALTER FUNCTION app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) RENAME TO begin_message_dispatch_pre_openwa;
CREATE FUNCTION app.begin_message_dispatch(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_guard jsonb,p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
  IF code IN('OPENWA_DAILY_LIMIT','OPENWA_NEW_CONVERSATION_LIMIT') THEN
   UPDATE app.message_outbox SET next_at=(((p_now AT TIME ZONE 'America/Sao_Paulo')::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo'),lease_until=NULL,blocked_code=code WHERE workspace_id=p_ws AND message_id=p_message;
  ELSE PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,code);END IF;RETURN reservation;
 END IF;
 result:=app.begin_message_dispatch_pre_openwa(p_ws,p_message,p_attempt,p_token,p_fence,p_guard,p_now);
 -- A refused final gate never establishes POST intent. Remove only this newly created hold.
 IF NOT COALESCE((result->>'allowed')::boolean,false) AND NOT had_reservation THEN DELETE FROM app.openwa_usage_reservation WHERE workspace_id=p_ws AND attempt_id=p_attempt AND NOT consumed;END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.begin_message_dispatch_pre_openwa(text,text,text,text,bigint,jsonb,timestamptz),app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) FROM PUBLIC,cadence_app,cadence_dispatcher;
GRANT EXECUTE ON FUNCTION app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) TO cadence_dispatcher;

ALTER FUNCTION app.record_message_dispatch_receipt(text,text,text,text,bigint,jsonb) RENAME TO record_message_dispatch_receipt_pre_openwa;
CREATE FUNCTION app.record_message_dispatch_receipt(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_receipt jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result boolean;
BEGIN
 result:=app.record_message_dispatch_receipt_pre_openwa(p_ws,p_message,p_attempt,p_token,p_fence,p_receipt);
 IF result THEN PERFORM app.settle_openwa_usage(p_ws,p_attempt);END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.record_message_dispatch_receipt_pre_openwa(text,text,text,text,bigint,jsonb),app.record_message_dispatch_receipt(text,text,text,text,bigint,jsonb) FROM PUBLIC,cadence_app,cadence_dispatcher;
GRANT EXECUTE ON FUNCTION app.record_message_dispatch_receipt(text,text,text,text,bigint,jsonb) TO cadence_dispatcher;

ALTER FUNCTION app.admin_reconcile_message(text,text,text,text,jsonb) RENAME TO admin_reconcile_message_pre_openwa;
CREATE FUNCTION app.admin_reconcile_message(p_message text,p_attempt text,p_resolution text,p_remote text,p_details jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF p_resolution='not_accepted' AND EXISTS(SELECT 1 FROM app.message_outbox o JOIN app.channel_connection c ON c.workspace_id=o.workspace_id AND c.id=o.connection_id WHERE o.workspace_id=current_setting('app.workspace_id',true) AND o.message_id=p_message AND c.provider='openwa') THEN RAISE EXCEPTION 'OPENWA_NON_ACCEPTANCE_UNPROVEN';END IF;
 PERFORM app.admin_reconcile_message_pre_openwa(p_message,p_attempt,p_resolution,p_remote,p_details);
END $$;
REVOKE ALL ON FUNCTION app.admin_reconcile_message_pre_openwa(text,text,text,text,jsonb),app.admin_reconcile_message(text,text,text,text,jsonb) FROM PUBLIC,cadence_app;
GRANT EXECUTE ON FUNCTION app.admin_reconcile_message(text,text,text,text,jsonb) TO cadence_app;
