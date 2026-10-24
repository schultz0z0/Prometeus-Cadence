CREATE FUNCTION app.retire_twilio_connections() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.cadence_publication p SET state='paused',revision=revision+1 WHERE state='active' AND(
  p.snapshot->'sender'->>'provider'='twilio' OR EXISTS(SELECT 1 FROM app.channel_sender s WHERE s.workspace_id=p.workspace_id AND s.id=p.snapshot->'sender'->>'id' AND s.provider='twilio') OR EXISTS(SELECT 1 FROM app.cadence_enrollment e JOIN app.cadence_enrollment_channel a ON a.workspace_id=e.workspace_id AND a.enrollment_id=e.id JOIN app.channel_sender s ON s.workspace_id=a.workspace_id AND s.id=a.sender_id WHERE e.workspace_id=p.workspace_id AND e.publication_id=p.id AND s.provider='twilio')
 );
 UPDATE app.message_outbox o SET state='cancelled',blocked_code='PROVIDER_RETIRED',lease_until=NULL WHERE o.state IN('pending','blocked') AND EXISTS(SELECT 1 FROM app.channel_connection c WHERE c.workspace_id=o.workspace_id AND c.id=o.connection_id AND c.provider='twilio') AND NOT EXISTS(SELECT 1 FROM app.message_dispatch_attempt a WHERE a.workspace_id=o.workspace_id AND a.message_id=o.message_id AND a.state IN('dispatching','accepted','uncertain'));
 UPDATE app.channel_message m SET state='cancelled',error_code='PROVIDER_RETIRED' WHERE m.state IN('pending','blocked') AND EXISTS(SELECT 1 FROM app.message_outbox o WHERE o.workspace_id=m.workspace_id AND o.message_id=m.id AND o.state='cancelled' AND o.blocked_code='PROVIDER_RETIRED');
 UPDATE app.channel_connection SET state='disconnected',credentials_verified=false,last_error='PROVIDER_RETIRED' WHERE provider='twilio';
 UPDATE app.channel_sender SET ready=false WHERE provider='twilio';
 UPDATE app.channel_received_event e SET time_lookup_state='done',lookup_token=NULL,lookup_until=NULL WHERE e.time_lookup_state<>'none' AND EXISTS(SELECT 1 FROM app.channel_connection c WHERE c.workspace_id=e.workspace_id AND c.id=e.connection_id AND c.provider='twilio');
END $$;
REVOKE ALL ON FUNCTION app.retire_twilio_connections() FROM PUBLIC,cadence_app,cadence_dispatcher,cadence_ingress;
SELECT app.retire_twilio_connections();

ALTER FUNCTION app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) RENAME TO begin_message_dispatch_pre_retirement;
CREATE FUNCTION app.begin_message_dispatch(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_guard jsonb,p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM app.message_outbox o JOIN app.channel_connection c ON c.workspace_id=o.workspace_id AND c.id=o.connection_id WHERE o.workspace_id=p_ws AND o.message_id=p_message AND c.provider='twilio') THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'PROVIDER_RETIRED');RETURN jsonb_build_object('allowed',false,'code','PROVIDER_RETIRED');END IF;
 RETURN app.begin_message_dispatch_pre_retirement(p_ws,p_message,p_attempt,p_token,p_fence,p_guard,p_now);
END $$;
REVOKE ALL ON FUNCTION app.begin_message_dispatch_pre_retirement(text,text,text,text,bigint,jsonb,timestamptz),app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) FROM PUBLIC,cadence_app,cadence_dispatcher;
GRANT EXECUTE ON FUNCTION app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) TO cadence_dispatcher;
-- Reject retired reads before generic readiness checks, including a legacy lease left after restart.
DO $$ DECLARE definition text;needle text:='scope_data:=app.message_dispatch_scope(p_ws,p_message);';BEGIN
 SELECT pg_get_functiondef('app.read_message_dispatch(text,text,text,bigint)'::regprocedure) INTO definition;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'RETIREMENT_READ_UPGRADE_REQUIRED';END IF;
 EXECUTE replace(definition,needle,needle||' IF scope_data->''connection''->>''provider''=''twilio'' THEN RETURN jsonb_build_object(''blocker'',''PROVIDER_RETIRED'');END IF;');
END $$;
