ALTER TABLE app.channel_connection DROP CONSTRAINT channel_connection_provider_check;
ALTER TABLE app.channel_connection ADD CONSTRAINT channel_connection_provider_check CHECK((channel='WHATSAPP' AND provider IN('meta','openwa','twilio')) OR(channel='EMAIL' AND provider IN('gmail','smtp-imap')));
ALTER TABLE app.channel_sender DROP CONSTRAINT channel_sender_provider_check;
ALTER TABLE app.channel_sender ADD CONSTRAINT channel_sender_provider_check CHECK((channel='WHATSAPP' AND provider IN('meta','openwa','twilio')) OR(channel='EMAIL' AND provider IN('gmail','smtp-imap')));

CREATE TABLE app.openwa_connection(
 workspace_id text NOT NULL,connection_id text NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 remote_name text NOT NULL UNIQUE CHECK(remote_name='pc-'||connection_id),remote_session_id uuid UNIQUE,
 phase text NOT NULL DEFAULT 'provisioning' CHECK(phase IN('provisioning','qr_ready','authenticating','ready','disconnected','action_required','failed')),
 desired_state text NOT NULL DEFAULT 'connected' CHECK(desired_state IN('connected','disconnected')),
 stage text NOT NULL DEFAULT 'session' CHECK(stage IN('session','key','webhook','start','observe','logout','revoke','idle')),
 api_key_id uuid,webhook_id uuid,webhook_registered boolean NOT NULL DEFAULT false,
 requested_by text NOT NULL,phone text CHECK(phone IS NULL OR phone~'^\+[0-9]{6,15}$'),
 last_checked_at timestamptz,error_code text CHECK(error_code IS NULL OR error_code~'^[A-Z0-9_]{1,100}$'),
 next_at timestamptz NOT NULL DEFAULT clock_timestamp(),attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 100),
 lease_token text,lease_until timestamptz,lease_revision bigint,fence bigint NOT NULL DEFAULT 0,
 messages_cursor text CHECK(length(messages_cursor)<=1024),messages_since timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,connection_id),FOREIGN KEY(workspace_id,connection_id) REFERENCES app.channel_connection(workspace_id,id)
);
CREATE INDEX openwa_operation_due ON app.openwa_connection(next_at) WHERE stage<>'idle';
ALTER TABLE app.openwa_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.openwa_connection FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.openwa_connection FROM PUBLIC,cadence_app,cadence_dispatcher,cadence_ingress;
CREATE POLICY tenant_read ON app.openwa_connection FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
CREATE POLICY admin_insert ON app.openwa_connection FOR INSERT WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
CREATE POLICY admin_update ON app.openwa_connection FOR UPDATE USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin')) WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
GRANT SELECT,INSERT,UPDATE ON app.openwa_connection TO cadence_app;

CREATE FUNCTION app.claim_openwa_operation(p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app.openwa_connection;token text;
BEGIN
 IF p_now IS NULL OR NOT isfinite(p_now) THEN RAISE EXCEPTION 'INVALID_OPENWA_CLOCK';END IF;
 SELECT o.* INTO q FROM app.openwa_connection o JOIN app.channel_connection c ON c.workspace_id=o.workspace_id AND c.id=o.connection_id
 WHERE o.stage<>'idle' AND o.next_at<=p_now AND o.revision=c.revision AND(o.lease_until IS NULL OR o.lease_until<clock_timestamp())
 AND EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=o.workspace_id AND m."userId"=o.requested_by AND m.role IN('owner','admin'))
 ORDER BY o.next_at,o.connection_id LIMIT 1 FOR UPDATE OF o SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 token:=gen_random_uuid()::text;
 UPDATE app.openwa_connection SET lease_token=token,lease_until=clock_timestamp()+interval '60 seconds',lease_revision=revision,fence=fence+1 WHERE workspace_id=q.workspace_id AND connection_id=q.connection_id;
 RETURN jsonb_build_object('workspaceId',q.workspace_id,'connectionId',q.connection_id,'token',token,'fence',q.fence+1,'revision',q.revision,'desiredState',q.desired_state);
END $$;
CREATE FUNCTION app.read_openwa_operation(p_ws text,p_connection text,p_token text,p_fence bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app.openwa_connection;c app.channel_connection;envelope jsonb;
BEGIN
 SELECT * INTO q FROM app.openwa_connection WHERE workspace_id=p_ws AND connection_id=p_connection AND lease_token=p_token AND fence=p_fence AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STALE_OPENWA_LEASE';END IF;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=p_ws AND id=p_connection;
 IF c.provider<>'openwa' OR c.revision<>q.revision OR q.lease_revision<>q.revision THEN RAISE EXCEPTION 'STALE_OPENWA_LEASE';END IF;
 PERFORM 1 FROM auth.member m WHERE m."organizationId"=p_ws AND m."userId"=q.requested_by AND m.role IN('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OPENWA_AUTHORITY_REVOKED';END IF;
 IF(q.desired_state='disconnected' AND q.stage NOT IN('logout','revoke','idle')) OR(q.desired_state='connected' AND q.stage IN('logout','revoke','idle')) THEN RAISE EXCEPTION 'STALE_OPENWA_LEASE';END IF;
 SELECT cr.envelope INTO envelope FROM app.channel_credential cr WHERE cr.workspace_id=p_ws AND cr.connection_id=p_connection AND cr.revision=c.revision;
 RETURN jsonb_build_object('operation',to_jsonb(q),'connection',to_jsonb(c),'envelope',envelope);
END $$;
CREATE FUNCTION app.heartbeat_openwa_operation(p_ws text,p_connection text,p_token text,p_fence bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.read_openwa_operation(p_ws,p_connection,p_token,p_fence);
 UPDATE app.openwa_connection SET lease_until=clock_timestamp()+interval '60 seconds' WHERE workspace_id=p_ws AND connection_id=p_connection AND lease_token=p_token AND fence=p_fence;
 RETURN FOUND;
END $$;
CREATE FUNCTION app.finish_openwa_operation(p_ws text,p_connection text,p_token text,p_fence bigint,p_result jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE data jsonb;q app.openwa_connection;kind text:=p_result->>'kind';
BEGIN
 data:=app.read_openwa_operation(p_ws,p_connection,p_token,p_fence);
 SELECT * INTO q FROM app.openwa_connection WHERE workspace_id=p_ws AND connection_id=p_connection FOR UPDATE;
 IF pg_column_size(p_result)>131072 OR jsonb_typeof(p_result)<>'object' THEN RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
 IF kind='session' AND q.stage='session' AND q.desired_state='connected' THEN
  IF p_result->>'sessionId' IS NULL OR(p_result-'kind'-'sessionId')<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
  UPDATE app.openwa_connection SET remote_session_id=(p_result->>'sessionId')::uuid,stage='key',attempts=0,error_code=NULL WHERE workspace_id=p_ws AND connection_id=p_connection;
 ELSIF kind='failure' THEN
  IF (p_result->>'code') IS NULL OR(p_result->>'code')!~'^[A-Z0-9_]{1,100}$' OR(p_result-'kind'-'code')<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
  UPDATE app.openwa_connection SET attempts=attempts+1,error_code=p_result->>'code',phase=CASE WHEN attempts>=4 THEN 'action_required' ELSE phase END,stage=CASE WHEN attempts>=4 THEN 'idle' ELSE stage END,
   next_at=clock_timestamp()+make_interval(secs=>LEAST(300,5*power(2,attempts)::integer)) WHERE workspace_id=p_ws AND connection_id=p_connection;
  UPDATE app.channel_connection SET state='attention',last_error=p_result->>'code' WHERE workspace_id=p_ws AND id=p_connection;
  UPDATE app.channel_sender SET ready=false WHERE workspace_id=p_ws AND connection_id=p_connection;
 ELSE RAISE EXCEPTION 'INVALID_OPENWA_RESULT';END IF;
 UPDATE app.openwa_connection SET lease_token=NULL,lease_until=NULL,lease_revision=NULL,updated_at=clock_timestamp(),next_at=CASE WHEN kind='failure' THEN next_at ELSE clock_timestamp() END WHERE workspace_id=p_ws AND connection_id=p_connection;
END $$;
REVOKE ALL ON FUNCTION app.claim_openwa_operation(timestamptz),app.read_openwa_operation(text,text,text,bigint),app.heartbeat_openwa_operation(text,text,text,bigint),app.finish_openwa_operation(text,text,text,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_openwa_operation(timestamptz),app.read_openwa_operation(text,text,text,bigint),app.heartbeat_openwa_operation(text,text,text,bigint),app.finish_openwa_operation(text,text,text,bigint,jsonb) TO cadence_dispatcher;
