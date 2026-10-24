CREATE TABLE app.openwa_platform_limits(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),daily_cap integer NOT NULL CHECK(daily_cap BETWEEN 1 AND 100000),new_conversation_cap integer NOT NULL CHECK(new_conversation_cap BETWEEN 1 AND daily_cap));
INSERT INTO app.openwa_platform_limits(singleton,daily_cap,new_conversation_cap) VALUES(true,20,5);
REVOKE ALL ON app.openwa_platform_limits FROM PUBLIC,cadence_app,cadence_dispatcher,cadence_ingress;
ALTER TABLE app.channel_sender ADD COLUMN new_conversation_limit integer CHECK(new_conversation_limit BETWEEN 1 AND daily_limit);
CREATE FUNCTION app.enforce_openwa_sender_limits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE caps app.openwa_platform_limits;
BEGIN
 IF NEW.provider='openwa' THEN
  SELECT * INTO caps FROM app.openwa_platform_limits WHERE singleton;
  IF NEW.new_conversation_limit IS NULL THEN NEW.new_conversation_limit:=LEAST(5,COALESCE(NEW.daily_limit,20),caps.new_conversation_cap);END IF;
  IF NEW.daily_limit IS NULL OR NEW.daily_limit>caps.daily_cap OR NEW.new_conversation_limit>caps.new_conversation_cap OR NEW.new_conversation_limit>NEW.daily_limit THEN RAISE EXCEPTION 'OPENWA_PLATFORM_LIMIT';END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.enforce_openwa_sender_limits() FROM PUBLIC;
CREATE TRIGGER openwa_sender_limits BEFORE INSERT OR UPDATE ON app.channel_sender FOR EACH ROW EXECUTE FUNCTION app.enforce_openwa_sender_limits();
UPDATE app.channel_sender SET new_conversation_limit=LEAST(5,daily_limit) WHERE provider='openwa';

CREATE TABLE app.openwa_usage_reservation(
 workspace_id text NOT NULL,attempt_id text NOT NULL,message_id text NOT NULL,sender_id text NOT NULL,identity_id text NOT NULL,period_date date NOT NULL,
 new_contact boolean NOT NULL,released boolean NOT NULL DEFAULT false,consumed boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,attempt_id),FOREIGN KEY(workspace_id,attempt_id) REFERENCES app.message_dispatch_attempt(workspace_id,id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES app.message_outbox(workspace_id,message_id),FOREIGN KEY(workspace_id,sender_id) REFERENCES app.channel_sender(workspace_id,id),FOREIGN KEY(workspace_id,identity_id) REFERENCES app.channel_identity(workspace_id,id)
);
CREATE INDEX openwa_usage_day ON app.openwa_usage_reservation(workspace_id,sender_id,period_date) WHERE NOT released;
ALTER TABLE app.openwa_usage_reservation ENABLE ROW LEVEL SECURITY;ALTER TABLE app.openwa_usage_reservation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.openwa_usage_reservation FROM PUBLIC,cadence_app,cadence_dispatcher,cadence_ingress;
CREATE POLICY tenant_read ON app.openwa_usage_reservation FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT ON app.openwa_usage_reservation TO cadence_app;
CREATE FUNCTION app.reserve_openwa_usage(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.message_outbox;s app.channel_sender;c app.channel_connection;caps app.openwa_platform_limits;period date;used integer;cold integer;new_person boolean;code text;last_inbound timestamptz;existing app.openwa_usage_reservation;
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
 SELECT count(*) INTO used FROM app.openwa_usage_reservation WHERE workspace_id=p_ws AND sender_id=s.id AND period_date=period AND NOT released;
 IF used>=LEAST(s.daily_limit,caps.daily_cap) THEN RETURN jsonb_build_object('allowed',false,'code','OPENWA_DAILY_LIMIT');END IF;
 new_person:=NOT EXISTS(SELECT 1 FROM app.channel_message m WHERE m.workspace_id=p_ws AND m.sender_id=s.id AND m.identity_id=o.identity_id AND m.id<>p_message AND(m.direction='inbound' OR m.state IN('accepted','delivered','read')));
 IF new_person AND NOT EXISTS(SELECT 1 FROM app.openwa_usage_reservation WHERE workspace_id=p_ws AND sender_id=s.id AND identity_id=o.identity_id AND period_date=period AND new_contact AND NOT released) THEN
  SELECT count(DISTINCT identity_id) INTO cold FROM app.openwa_usage_reservation WHERE workspace_id=p_ws AND sender_id=s.id AND period_date=period AND new_contact AND NOT released;
  IF cold>=LEAST(s.new_conversation_limit,caps.new_conversation_cap) THEN RETURN jsonb_build_object('allowed',false,'code','OPENWA_NEW_CONVERSATION_LIMIT');END IF;
 END IF;
 INSERT INTO app.openwa_usage_reservation(workspace_id,attempt_id,message_id,sender_id,identity_id,period_date,new_contact) VALUES(p_ws,p_attempt,p_message,s.id,o.identity_id,period,new_person);
 RETURN jsonb_build_object('allowed',true);
END $$;
CREATE FUNCTION app.settle_openwa_usage(p_ws text,p_attempt text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.message_dispatch_attempt;
BEGIN
 SELECT * INTO a FROM app.message_dispatch_attempt WHERE workspace_id=p_ws AND id=p_attempt;IF NOT FOUND THEN RETURN;END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 IF a.state='not_accepted' THEN UPDATE app.openwa_usage_reservation SET released=true WHERE workspace_id=p_ws AND attempt_id=p_attempt AND NOT consumed;
 ELSIF a.state='accepted' THEN UPDATE app.openwa_usage_reservation SET consumed=true WHERE workspace_id=p_ws AND attempt_id=p_attempt AND NOT released;END IF;
END $$;
REVOKE ALL ON FUNCTION app.reserve_openwa_usage(text,text,text,text,bigint,timestamptz),app.settle_openwa_usage(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reserve_openwa_usage(text,text,text,text,bigint,timestamptz),app.settle_openwa_usage(text,text) TO cadence_dispatcher;
