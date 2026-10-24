ALTER TABLE app.openwa_connection ADD COLUMN pairing_deadline timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes';
ALTER TABLE app.openwa_connection ADD COLUMN pairing_completed boolean NOT NULL DEFAULT false;
ALTER TABLE app.openwa_connection ADD COLUMN protected_since timestamptz;
UPDATE app.openwa_connection SET pairing_completed=(phase='ready'),protected_since=CASE WHEN webhook_registered THEN COALESCE(last_checked_at,updated_at) ELSE NULL END;
ALTER TABLE app.openwa_connection DROP CONSTRAINT openwa_connection_stage_check;
ALTER TABLE app.openwa_connection ADD CONSTRAINT openwa_connection_stage_check CHECK(stage IN('session','key','webhook','stop','start','observe','logout','revoke','idle','expire_stop'));
ALTER TABLE app.openwa_recovery ADD COLUMN completed_at timestamptz;

CREATE FUNCTION app.openwa_revision_boundary() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.revision<>OLD.revision THEN NEW.pairing_deadline:=clock_timestamp()+interval '10 minutes';NEW.pairing_completed:=false;NEW.protected_since:=NULL;END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.openwa_revision_boundary() FROM PUBLIC;
CREATE TRIGGER openwa_revision_boundary BEFORE UPDATE ON app.openwa_connection FOR EACH ROW EXECUTE FUNCTION app.openwa_revision_boundary();

CREATE FUNCTION app.expire_openwa_pairing(p_ws text,p_connection text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.openwa_connection SET stage='expire_stop',phase='action_required',automation_paused=true,error_code='OPENWA_PAIRING_EXPIRED',next_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,lease_revision=NULL,fence=fence+1 WHERE workspace_id=p_ws AND connection_id=p_connection AND desired_state='connected' AND NOT pairing_completed AND pairing_deadline<=clock_timestamp() AND stage NOT IN('expire_stop','idle');
 IF NOT FOUND THEN RETURN;END IF;
 UPDATE app.channel_connection SET state='attention',credentials_verified=false,last_error='OPENWA_PAIRING_EXPIRED' WHERE workspace_id=p_ws AND id=p_connection;
 UPDATE app.channel_sender SET ready=false WHERE workspace_id=p_ws AND connection_id=p_connection;
END $$;
REVOKE ALL ON FUNCTION app.expire_openwa_pairing(text,text) FROM PUBLIC;
ALTER FUNCTION app.claim_openwa_operation(timestamptz) RENAME TO claim_openwa_operation_pre_deadline;
CREATE FUNCTION app.claim_openwa_operation(p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record;
BEGIN
 FOR item IN SELECT workspace_id,connection_id FROM app.openwa_connection WHERE desired_state='connected' AND NOT pairing_completed AND pairing_deadline<=clock_timestamp() AND stage NOT IN('expire_stop','idle') ORDER BY pairing_deadline LIMIT 5 FOR UPDATE SKIP LOCKED LOOP
  PERFORM app.expire_openwa_pairing(item.workspace_id,item.connection_id);
 END LOOP;
 RETURN app.claim_openwa_operation_pre_deadline(p_now);
END $$;
REVOKE ALL ON FUNCTION app.claim_openwa_operation_pre_deadline(timestamptz),app.claim_openwa_operation(timestamptz) FROM PUBLIC,cadence_app,cadence_dispatcher;
GRANT EXECUTE ON FUNCTION app.claim_openwa_operation(timestamptz) TO cadence_dispatcher;

ALTER FUNCTION app.finish_openwa_operation(text,text,text,bigint,jsonb) RENAME TO finish_openwa_operation_pre_deadline;
CREATE FUNCTION app.finish_openwa_operation(p_ws text,p_connection text,p_token text,p_fence bigint,p_result jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE data jsonb;q app.openwa_connection;
BEGIN
 data:=app.read_openwa_operation(p_ws,p_connection,p_token,p_fence);
 SELECT * INTO q FROM app.openwa_connection WHERE workspace_id=p_ws AND connection_id=p_connection FOR UPDATE;
 IF q.desired_state='connected' AND NOT q.pairing_completed AND q.pairing_deadline<=clock_timestamp() AND q.stage<>'expire_stop' THEN PERFORM app.expire_openwa_pairing(p_ws,p_connection);RETURN;END IF;
 IF p_result->>'kind'='expired' AND q.stage='expire_stop' AND q.desired_state='connected' THEN
  IF p_result-'kind'<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
  UPDATE app.openwa_connection SET stage='idle',phase='action_required',automation_paused=true,error_code='OPENWA_PAIRING_EXPIRED',lease_token=NULL,lease_until=NULL,lease_revision=NULL WHERE workspace_id=p_ws AND connection_id=p_connection;RETURN;
 END IF;
 PERFORM app.finish_openwa_operation_pre_deadline(p_ws,p_connection,p_token,p_fence,p_result);
 IF p_result->>'kind'='webhook' THEN UPDATE app.openwa_connection SET protected_since=clock_timestamp() WHERE workspace_id=p_ws AND connection_id=p_connection;
 ELSIF p_result->>'kind'='status' THEN UPDATE app.openwa_connection SET pairing_completed=pairing_completed OR phase='ready' WHERE workspace_id=p_ws AND connection_id=p_connection;END IF;
END $$;
REVOKE ALL ON FUNCTION app.finish_openwa_operation_pre_deadline(text,text,text,bigint,jsonb),app.finish_openwa_operation(text,text,text,bigint,jsonb) FROM PUBLIC,cadence_app,cadence_dispatcher;
GRANT EXECUTE ON FUNCTION app.finish_openwa_operation(text,text,text,bigint,jsonb) TO cadence_dispatcher;

DO $$ DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('app.claim_openwa_recovery(timestamptz)'::regprocedure) INTO definition;
 IF position('o.messages_since-interval ''2 seconds''' IN definition)=0 THEN RAISE EXCEPTION 'RECOVERY_BOUNDARY_UPGRADE_REQUIRED';END IF;
 definition:=replace(definition,'o.messages_since-interval ''2 seconds''','COALESCE(o.protected_since,o.last_checked_at,p_now)-interval ''2 seconds''');
 definition:=replace(definition,'p_now-interval ''60 seconds''','COALESCE(q.protected_since,p_now)-interval ''2 seconds''');EXECUTE definition;
END $$;
ALTER FUNCTION app.finish_openwa_recovery(text,text,text,bigint,jsonb) RENAME TO finish_openwa_recovery_pre_freshness;
CREATE FUNCTION app.finish_openwa_recovery(p_ws text,p_connection text,p_token text,p_fence bigint,p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE accepted boolean;
BEGIN
 accepted:=app.finish_openwa_recovery_pre_freshness(p_ws,p_connection,p_token,p_fence,p_result);
 IF accepted AND p_result->>'kind'='page' AND p_result->>'cursor' IS NULL THEN UPDATE app.openwa_recovery SET completed_at=clock_timestamp() WHERE workspace_id=p_ws AND connection_id=p_connection;END IF;
 RETURN accepted;
END $$;
REVOKE ALL ON FUNCTION app.finish_openwa_recovery_pre_freshness(text,text,text,bigint,jsonb),app.finish_openwa_recovery(text,text,text,bigint,jsonb) FROM PUBLIC,cadence_app,cadence_dispatcher;
GRANT EXECUTE ON FUNCTION app.finish_openwa_recovery(text,text,text,bigint,jsonb) TO cadence_dispatcher;

ALTER FUNCTION app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) RENAME TO begin_message_dispatch_pre_recovery;
CREATE FUNCTION app.begin_message_dispatch(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_guard jsonb,p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.message_outbox;c app.channel_connection;
BEGIN
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=p_ws AND message_id=p_message AND lease_token=p_token AND fence=p_fence AND lease_until>clock_timestamp() AND state='pending' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'code','STALE_LEASE');END IF;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=p_ws AND id=o.connection_id;
 IF c.provider='openwa' AND NOT EXISTS(SELECT 1 FROM app.openwa_recovery r JOIN app.openwa_connection q ON q.workspace_id=r.workspace_id AND q.connection_id=r.connection_id WHERE r.workspace_id=p_ws AND r.connection_id=c.id AND r.revision=c.revision AND q.revision=c.revision AND r.window_until IS NULL AND r.cursor IS NULL AND r.failures=0 AND r.checkpoint>=p_now-interval '45 seconds' AND r.checkpoint<=p_now+interval '2 seconds' AND r.completed_at>clock_timestamp()-interval '45 seconds' AND q.last_checked_at>clock_timestamp()-interval '60 seconds') THEN
  UPDATE app.message_outbox SET next_at=p_now+interval '5 seconds',lease_until=NULL,blocked_code='OPENWA_SYNC_REQUIRED' WHERE workspace_id=p_ws AND message_id=p_message;
  RETURN jsonb_build_object('allowed',false,'code','OPENWA_SYNC_REQUIRED');
 END IF;
 RETURN app.begin_message_dispatch_pre_recovery(p_ws,p_message,p_attempt,p_token,p_fence,p_guard,p_now);
END $$;
REVOKE ALL ON FUNCTION app.begin_message_dispatch_pre_recovery(text,text,text,text,bigint,jsonb,timestamptz),app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) FROM PUBLIC,cadence_app,cadence_dispatcher;
GRANT EXECUTE ON FUNCTION app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) TO cadence_dispatcher;
