-- 07C.3a: the product's own OAuth authorization server for its MCP endpoint. Clients register themselves (RFC 7591,
-- public clients with PKCE S256); a member consents for the active workspace; tokens are opaque and stored as SHA-256.
-- Codes live 60 s and are single use; access tokens 15 min, bound to the resource; refresh tokens 7 days and rotate:
-- reusing a code or an old refresh revokes the whole grant. A token acts as its user, only while still a member.
CREATE TABLE app.mcp_client(
 id text PRIMARY KEY,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 redirect_uris text[] NOT NULL CHECK(cardinality(redirect_uris) BETWEEN 1 AND 5),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mcp_client_recent ON app.mcp_client(created_at);
CREATE TABLE app.mcp_auth_request(
 id text PRIMARY KEY,client_id text NOT NULL REFERENCES app.mcp_client(id) ON DELETE CASCADE,redirect_uri text NOT NULL,code_challenge text NOT NULL,
 scopes text[] NOT NULL,state text CHECK(length(state)<=500),resource text NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.mcp_grant(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,client_id text NOT NULL REFERENCES app.mcp_client(id),user_id text NOT NULL,
 scopes text[] NOT NULL,resource text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_used_at timestamptz,
 revoked_at timestamptz,revoked_reason text,window_start timestamptz,window_count integer NOT NULL DEFAULT 0,
 PRIMARY KEY(workspace_id,id),UNIQUE(id)
);
CREATE TABLE app.mcp_auth_code(
 code_hash text PRIMARY KEY,grant_id text NOT NULL REFERENCES app.mcp_grant(id) ON DELETE CASCADE,client_id text NOT NULL,redirect_uri text NOT NULL,
 code_challenge text NOT NULL,resource text NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz
);
CREATE TABLE app.mcp_token(
 token_hash text PRIMARY KEY,kind text NOT NULL CHECK(kind IN('access','refresh')),grant_id text NOT NULL REFERENCES app.mcp_grant(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mcp_token_grant ON app.mcp_token(grant_id);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['mcp_client','mcp_auth_request','mcp_grant','mcp_auth_code','mcp_token'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
END LOOP;END $$;

-- Registration is anonymous: bounded per hour so it cannot fill the table.
CREATE FUNCTION app.mcp_register_client(p_id text,p_name text,p_uris text[]) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (SELECT count(*) FROM app.mcp_client WHERE created_at>clock_timestamp()-interval '1 hour')>=500 THEN RETURN false;END IF;
 INSERT INTO app.mcp_client(id,name,redirect_uris) VALUES(p_id,p_name,p_uris);RETURN true;
END $$;
-- 'ok' | 'unknown_client' | 'bad_redirect'. The redirect must be one the client registered, exactly.
CREATE FUNCTION app.mcp_start_request(p_id text,p_client text,p_redirect text,p_challenge text,p_scopes text[],p_state text,p_resource text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.mcp_client;
BEGIN
 SELECT * INTO c FROM app.mcp_client WHERE id=p_client;
 IF NOT FOUND THEN RETURN 'unknown_client';END IF;
 IF NOT p_redirect=ANY(c.redirect_uris) THEN RETURN 'bad_redirect';END IF;
 IF p_challenge IS NULL THEN RETURN 'ok';END IF;
 DELETE FROM app.mcp_auth_request WHERE expires_at<clock_timestamp()-interval '1 day';
 INSERT INTO app.mcp_auth_request(id,client_id,redirect_uri,code_challenge,scopes,state,resource,expires_at) VALUES(p_id,p_client,p_redirect,p_challenge,p_scopes,p_state,p_resource,clock_timestamp()+interval '10 minutes');
 RETURN 'ok';
END $$;
CREATE FUNCTION app.mcp_read_request(p_id text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('client',c.name,'redirectUri',r.redirect_uri,'scopes',to_jsonb(r.scopes),'state',r.state,'used',r.used_at IS NOT NULL,'expired',r.expires_at<=clock_timestamp())
 FROM app.mcp_auth_request r JOIN app.mcp_client c ON c.id=r.client_id WHERE r.id=p_id
$$;
-- In the member's workspace transaction: one decision per request; allowing creates the grant and a 60-second code.
CREATE FUNCTION app.mcp_decide(p_id text,p_allow boolean,p_grant text,p_code_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);r app.mcp_auth_request;
BEGIN
 IF app.current_role() IS NULL THEN RAISE EXCEPTION 'MCP_ACCESS';END IF;
 SELECT * INTO r FROM app.mcp_auth_request WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MCP_REQUEST_NOT_FOUND';END IF;
 IF r.used_at IS NOT NULL THEN RAISE EXCEPTION 'MCP_REQUEST_USED';END IF;
 IF r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'MCP_REQUEST_EXPIRED';END IF;
 UPDATE app.mcp_auth_request SET used_at=clock_timestamp() WHERE id=p_id;
 IF p_allow THEN
  INSERT INTO app.mcp_grant(workspace_id,id,client_id,user_id,scopes,resource) VALUES(ws,p_grant,r.client_id,uid,r.scopes,r.resource);
  INSERT INTO app.mcp_auth_code(code_hash,grant_id,client_id,redirect_uri,code_challenge,resource,expires_at) VALUES(p_code_hash,p_grant,r.client_id,r.redirect_uri,r.code_challenge,r.resource,clock_timestamp()+interval '60 seconds');
 END IF;
 RETURN jsonb_build_object('redirectUri',r.redirect_uri,'state',r.state);
END $$;
CREATE FUNCTION app.mcp_revoke_grant(p_grant text,p_reason text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE app.mcp_grant SET revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_reason=coalesce(revoked_reason,p_reason) WHERE id=p_grant;
 DELETE FROM app.mcp_token WHERE grant_id=p_grant;
$$;
CREATE FUNCTION app.mcp_grant_live(g app.mcp_grant) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT g.revoked_at IS NULL AND EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=g.workspace_id AND m."userId"=g.user_id AND m.role IN('owner','admin','operator'))
$$;
CREATE FUNCTION app.mcp_issue(p_grant text,p_access text,p_refresh text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 INSERT INTO app.mcp_token(token_hash,kind,grant_id,expires_at) VALUES(p_access,'access',p_grant,clock_timestamp()+interval '15 minutes'),(p_refresh,'refresh',p_grant,clock_timestamp()+interval '7 days');
$$;
-- The PKCE challenge is computed by the caller from the verifier; a code is consumed by any attempt, and reused it revokes.
CREATE FUNCTION app.mcp_exchange_code(p_code_hash text,p_client text,p_redirect text,p_challenge text,p_resource text,p_access text,p_refresh text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k app.mcp_auth_code;g app.mcp_grant;
BEGIN
 SELECT * INTO k FROM app.mcp_auth_code WHERE code_hash=p_code_hash FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','invalid_grant');END IF;
 IF k.used_at IS NOT NULL THEN PERFORM app.mcp_revoke_grant(k.grant_id,'code_reuse');RETURN jsonb_build_object('error','invalid_grant');END IF;
 UPDATE app.mcp_auth_code SET used_at=clock_timestamp() WHERE code_hash=p_code_hash;
 SELECT * INTO g FROM app.mcp_grant WHERE id=k.grant_id FOR UPDATE;
 IF k.expires_at<=clock_timestamp() OR k.client_id<>p_client OR k.redirect_uri<>p_redirect OR k.code_challenge<>p_challenge OR (p_resource IS NOT NULL AND p_resource<>k.resource) OR NOT app.mcp_grant_live(g) THEN
  RETURN jsonb_build_object('error','invalid_grant');END IF;
 PERFORM app.mcp_issue(g.id,p_access,p_refresh);
 RETURN jsonb_build_object('scopes',to_jsonb(g.scopes));
END $$;
CREATE FUNCTION app.mcp_refresh(p_hash text,p_client text,p_resource text,p_access text,p_refresh text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.mcp_token;g app.mcp_grant;
BEGIN
 SELECT * INTO t FROM app.mcp_token WHERE token_hash=p_hash AND kind='refresh' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','invalid_grant');END IF;
 SELECT * INTO g FROM app.mcp_grant WHERE id=t.grant_id FOR UPDATE;
 IF t.used_at IS NOT NULL THEN PERFORM app.mcp_revoke_grant(g.id,'refresh_reuse');RETURN jsonb_build_object('error','invalid_grant');END IF;
 IF t.expires_at<=clock_timestamp() OR g.client_id<>p_client OR (p_resource IS NOT NULL AND p_resource<>g.resource) OR NOT app.mcp_grant_live(g) THEN RETURN jsonb_build_object('error','invalid_grant');END IF;
 UPDATE app.mcp_token SET used_at=clock_timestamp() WHERE token_hash=p_hash;
 PERFORM app.mcp_issue(g.id,p_access,p_refresh);
 RETURN jsonb_build_object('scopes',to_jsonb(g.scopes));
END $$;
CREATE FUNCTION app.mcp_revoke_token(p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE gid text;
BEGIN SELECT grant_id INTO gid FROM app.mcp_token WHERE token_hash=p_hash;IF gid IS NOT NULL THEN PERFORM app.mcp_revoke_grant(gid,'revoked');END IF;END $$;
-- Per call: the access token for this resource, the grant, the membership and 120 calls a minute per grant.
CREATE FUNCTION app.mcp_resolve_token(p_hash text,p_resource text) RETURNS TABLE(workspace_id text,user_id text,role text,grant_id text,scopes text[],retry_after integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g app.mcp_grant;r text;
BEGIN
 SELECT gr.* INTO g FROM app.mcp_token t JOIN app.mcp_grant gr ON gr.id=t.grant_id
  WHERE t.token_hash=p_hash AND t.kind='access' AND t.expires_at>clock_timestamp() AND gr.revoked_at IS NULL AND gr.resource=p_resource FOR UPDATE OF gr;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT m.role INTO r FROM auth.member m WHERE m."organizationId"=g.workspace_id AND m."userId"=g.user_id AND m.role IN('owner','admin','operator');
 IF g.window_start IS NULL OR g.window_start<=clock_timestamp()-interval '1 minute' THEN
  UPDATE app.mcp_grant SET window_start=clock_timestamp(),window_count=1,last_used_at=clock_timestamp() WHERE id=g.id;
 ELSIF g.window_count>=120 THEN
  RETURN QUERY SELECT g.workspace_id,g.user_id,r,g.id,g.scopes,greatest(1,ceil(extract(epoch FROM g.window_start+interval '1 minute'-clock_timestamp()))::integer);RETURN;
 ELSE UPDATE app.mcp_grant SET window_count=window_count+1,last_used_at=clock_timestamp() WHERE id=g.id;END IF;
 RETURN QUERY SELECT g.workspace_id,g.user_id,r,g.id,g.scopes,0;
END $$;
-- Settings: owners and admins see and revoke every connection of the workspace; others only their own.
CREATE FUNCTION app.list_mcp_connections() RETURNS TABLE(id text,client_name text,user_id text,user_name text,scopes text[],created_at timestamptz,last_used_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);me text:=app.current_role();
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'MCP_ACCESS';END IF;
 RETURN QUERY SELECT g.id,c.name,g.user_id,u.name,g.scopes,g.created_at,g.last_used_at FROM app.mcp_grant g JOIN app.mcp_client c ON c.id=g.client_id LEFT JOIN auth."user" u ON u.id=g.user_id
  WHERE g.workspace_id=ws AND g.revoked_at IS NULL AND (me IN('owner','admin') OR g.user_id=uid) ORDER BY g.created_at DESC,g.id;
END $$;
CREATE FUNCTION app.revoke_mcp_connection(p_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);me text:=app.current_role();g app.mcp_grant;
BEGIN
 SELECT * INTO g FROM app.mcp_grant WHERE workspace_id=ws AND id=p_id AND revoked_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MCP_CONNECTION_NOT_FOUND';END IF;
 IF me IS NULL OR (me NOT IN('owner','admin') AND g.user_id<>uid) THEN RAISE EXCEPTION 'MCP_ACCESS';END IF;
 PERFORM app.mcp_revoke_grant(g.id,'settings');
END $$;

DO $$ DECLARE f text;BEGIN FOREACH f IN ARRAY ARRAY['app.mcp_register_client(text,text,text[])','app.mcp_start_request(text,text,text,text,text[],text,text)','app.mcp_read_request(text)',
 'app.mcp_decide(text,boolean,text,text)','app.mcp_revoke_grant(text,text)','app.mcp_grant_live(app.mcp_grant)','app.mcp_issue(text,text,text)',
 'app.mcp_exchange_code(text,text,text,text,text,text,text)','app.mcp_refresh(text,text,text,text,text)','app.mcp_revoke_token(text)','app.mcp_resolve_token(text,text)',
 'app.list_mcp_connections()','app.revoke_mcp_connection(text)'] LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC';END LOOP;END $$;
GRANT EXECUTE ON FUNCTION app.mcp_register_client(text,text,text[]),app.mcp_start_request(text,text,text,text,text[],text,text),app.mcp_read_request(text),
 app.mcp_decide(text,boolean,text,text),app.mcp_exchange_code(text,text,text,text,text,text,text),app.mcp_refresh(text,text,text,text,text),app.mcp_revoke_token(text),
 app.mcp_resolve_token(text,text),app.list_mcp_connections(),app.revoke_mcp_connection(text) TO cadence_app;
