-- 07C.2a: customer connector credentials. A pasted key becomes a single-use credential reference (10 min, same user,
-- workspace and kind); a verified connection keeps the key encrypted per workspace. Nothing here is readable by the app role.
CREATE TABLE app.connector_credential_ref(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,user_id text NOT NULL,kind text NOT NULL CHECK(kind IN('apollo')),
 secret jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',consumed_at timestamptz,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE app.integration_connection(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,kind text NOT NULL CHECK(kind IN('apollo')),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
 state text NOT NULL DEFAULT 'ready' CHECK(state IN('ready','attention','revoked')),secret jsonb,capabilities text[] NOT NULL,revision bigint NOT NULL DEFAULT 1,
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),verified_at timestamptz,last_error text CHECK(length(last_error)<=300),revoked_at timestamptz,
 PRIMARY KEY(workspace_id,id)
);
CREATE UNIQUE INDEX integration_connection_one_live ON app.integration_connection(workspace_id,kind) WHERE state<>'revoked';
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['connector_credential_ref','integration_connection'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
END LOOP;END $$;
CREATE POLICY tenant_read ON app.integration_connection FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT(workspace_id,id,kind,name,state,capabilities,revision,created_at,verified_at,last_error) ON app.integration_connection TO cadence_app;

CREATE FUNCTION app.connector_actor() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r text:=app.lock_membership();
BEGIN
 IF r IS NULL OR r NOT IN('owner','admin') THEN RAISE EXCEPTION 'CONNECTOR_ACCESS';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(current_setting('app.workspace_id',true)||':connectors',0));RETURN r;
END $$;
CREATE FUNCTION app.store_connector_credential(p_id text,p_kind text,p_secret jsonb) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v timestamptz;
BEGIN
 PERFORM app.connector_actor();
 DELETE FROM app.connector_credential_ref WHERE expires_at<clock_timestamp()-interval '1 hour';
 INSERT INTO app.connector_credential_ref(workspace_id,id,user_id,kind,secret) VALUES(current_setting('app.workspace_id',true),p_id,current_setting('app.user_id',true),p_kind,p_secret) RETURNING expires_at INTO v;
 RETURN v;
END $$;
-- Another user's, workspace's or kind's reference is forbidden; an expired or used one is a conflict. Either way nothing is returned.
CREATE FUNCTION app.consume_connector_credential(p_id text,p_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.connector_credential_ref;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO r FROM app.connector_credential_ref WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_id FOR UPDATE;
 IF NOT FOUND OR r.user_id<>current_setting('app.user_id',true) OR r.kind<>p_kind THEN RAISE EXCEPTION 'CREDENTIAL_FORBIDDEN';END IF;
 IF r.consumed_at IS NOT NULL OR r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CREDENTIAL_USED';END IF;
 UPDATE app.connector_credential_ref SET consumed_at=clock_timestamp(),secret='{}'::jsonb WHERE workspace_id=r.workspace_id AND id=p_id;
 RETURN r.secret;
END $$;
-- One live connection per kind; replacing it requires the revision the person saw.
CREATE FUNCTION app.save_connection(p_id text,p_kind text,p_name text,p_secret jsonb,p_caps text[],p_expected bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.integration_connection;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=ws AND kind=p_kind AND state<>'revoked' FOR UPDATE;
 IF FOUND THEN
  IF r.id<>p_id OR r.revision<>p_expected THEN RAISE EXCEPTION 'CONNECTION_CONFLICT';END IF;
  UPDATE app.integration_connection SET name=p_name,secret=p_secret,state='ready',last_error=NULL,verified_at=clock_timestamp(),revision=revision+1 WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
 ELSE
  IF p_expected<>0 THEN RAISE EXCEPTION 'CONNECTION_CONFLICT';END IF;
  INSERT INTO app.integration_connection(workspace_id,id,kind,name,secret,capabilities,created_by,verified_at) VALUES(ws,p_id,p_kind,p_name,p_secret,p_caps,current_setting('app.user_id',true),clock_timestamp()) RETURNING * INTO r;
 END IF;
 RETURN r.revision;
END $$;
CREATE FUNCTION app.revoke_connection(p_id text,p_expected bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.integration_connection;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=ws AND id=p_id AND state<>'revoked' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_NOT_FOUND';END IF;
 IF r.revision<>p_expected THEN RAISE EXCEPTION 'CONNECTION_CONFLICT';END IF;
 UPDATE app.integration_connection SET state='revoked',secret=NULL,revoked_at=clock_timestamp(),revision=revision+1 WHERE workspace_id=ws AND id=p_id;
END $$;
-- The prospecting worker reads the key of its own job's workspace, only for the exact revision reviewed at confirmation.
CREATE FUNCTION app.connector_secret(p_id text,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.integration_connection;
BEGIN
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_id;
 IF NOT FOUND OR r.state<>'ready' OR r.revision<>p_revision OR r.secret IS NULL THEN RAISE EXCEPTION 'CONNECTION_CHANGED';END IF;
 RETURN r.secret;
END $$;
-- The app reads only whether a live connection exists and its revision (for review proofs), never the key.
CREATE FUNCTION app.live_connection(p_kind text) RETURNS TABLE(id text,revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT c.id,c.revision FROM app.integration_connection c WHERE c.workspace_id=current_setting('app.workspace_id',true) AND c.kind=p_kind AND c.state='ready' AND app.current_role() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION app.connector_actor(),app.store_connector_credential(text,text,jsonb),app.consume_connector_credential(text,text),app.save_connection(text,text,text,jsonb,text[],bigint),app.revoke_connection(text,bigint),app.connector_secret(text,bigint),app.live_connection(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.store_connector_credential(text,text,jsonb),app.consume_connector_credential(text,text),app.save_connection(text,text,text,jsonb,text[],bigint),app.revoke_connection(text,bigint),app.live_connection(text) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.connector_secret(text,bigint),app.live_connection(text) TO cadence_worker;
