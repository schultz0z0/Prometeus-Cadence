CREATE TABLE app.channel_connection(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,provider text NOT NULL CHECK(provider IN('meta','twilio')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),public_id text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','credentials_verified','awaiting_webhook','ready','attention','disconnected')),
 identifiers jsonb NOT NULL CHECK(pg_column_size(identifiers)<=65536),external_account_id text,
 credentials_verified boolean NOT NULL DEFAULT false,challenge_verified boolean NOT NULL DEFAULT false,inbound_verified boolean NOT NULL DEFAULT false,
 token_expires_at timestamptz,last_error text,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(id)
);
CREATE TABLE app.channel_credential(
 workspace_id text NOT NULL,connection_id text NOT NULL,revision bigint NOT NULL,envelope jsonb NOT NULL CHECK(pg_column_size(envelope)<=131072),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,connection_id,revision),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES app.channel_connection(workspace_id,id)
);
CREATE TABLE app.channel_sender(
 workspace_id text NOT NULL,id text NOT NULL,connection_id text NOT NULL,provider text NOT NULL CHECK(provider IN('meta','twilio')),
 address text,external_id text NOT NULL,identity_scope text NOT NULL,revision bigint NOT NULL DEFAULT 1,ready boolean NOT NULL DEFAULT false,
 daily_limit integer CHECK(daily_limit BETWEEN 1 AND 100000),capabilities jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,connection_id,external_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES app.channel_connection(workspace_id,id)
);
CREATE TABLE app.channel_remote_template(
 workspace_id text NOT NULL,id text NOT NULL,connection_id text NOT NULL,remote_id text NOT NULL,revision bigint NOT NULL DEFAULT 1,
 payload jsonb NOT NULL CHECK(pg_column_size(payload)<=131072),synced_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,connection_id,remote_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES app.channel_connection(workspace_id,id)
);
CREATE TABLE app.channel_account_ownership(
 provider text NOT NULL,external_account_id text NOT NULL,external_sender_id text NOT NULL DEFAULT '',workspace_id text NOT NULL,connection_id text NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(provider,external_account_id,external_sender_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES app.channel_connection(workspace_id,id)
);
CREATE TABLE app.messaging_limits(
 workspace_id text PRIMARY KEY REFERENCES auth.organization(id),revision bigint NOT NULL DEFAULT 1,workspace_daily_limit integer NOT NULL CHECK(workspace_daily_limit BETWEEN 1 AND 100000),
 timezone text NOT NULL DEFAULT 'America/Sao_Paulo'
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['channel_connection','channel_sender','channel_remote_template','messaging_limits'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON app.%I FROM cadence_app',t);
  EXECUTE format('CREATE POLICY tenant_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
  EXECUTE format('CREATE POLICY admin_insert ON app.%I FOR INSERT WITH CHECK(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IN(''owner'',''admin''))',t);
  EXECUTE format('CREATE POLICY admin_update ON app.%I FOR UPDATE USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IN(''owner'',''admin'')) WITH CHECK(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IN(''owner'',''admin''))',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON app.%I TO cadence_app',t);
 END LOOP;
END $$;
ALTER TABLE app.channel_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.channel_credential FORCE ROW LEVEL SECURITY;
ALTER TABLE app.channel_account_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.channel_account_ownership FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.channel_credential,app.channel_account_ownership FROM cadence_app;
GRANT USAGE ON SCHEMA app TO cadence_ingress,cadence_dispatcher;

CREATE FUNCTION app.read_channel_credential(p_id text,p_revision bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE conn app.channel_connection; result jsonb;
BEGIN
 IF app.current_role() NOT IN('owner','admin') OR app.current_role() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO conn FROM app.channel_connection WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHANNEL_NOT_FOUND';END IF;
 SELECT envelope INTO result FROM app.channel_credential WHERE workspace_id=conn.workspace_id AND connection_id=conn.id AND revision=COALESCE(p_revision,conn.revision);
 RETURN result;
END $$;
CREATE FUNCTION app.write_channel_credential(p_id text,p_revision bigint,p_envelope jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE conn app.channel_connection;
BEGIN
 IF app.current_role() NOT IN('owner','admin') OR app.current_role() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO conn FROM app.channel_connection WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_id FOR UPDATE;
 IF NOT FOUND OR conn.revision<>p_revision OR pg_column_size(p_envelope)>131072 THEN RAISE EXCEPTION 'CHANNEL_CHANGED';END IF;
 IF NOT(p_envelope ?& ARRAY['keyId','iv','tag','ciphertext']) THEN RAISE EXCEPTION 'INVALID_CREDENTIAL';END IF;
 INSERT INTO app.channel_credential(workspace_id,connection_id,revision,envelope) VALUES(conn.workspace_id,conn.id,p_revision,p_envelope);
END $$;
REVOKE ALL ON FUNCTION app.read_channel_credential(text,bigint),app.write_channel_credential(text,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_channel_credential(text,bigint),app.write_channel_credential(text,bigint,jsonb) TO cadence_app;
