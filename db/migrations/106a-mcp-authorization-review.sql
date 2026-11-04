-- 07C.3a review. Anonymous registration is capped per address (and globally, higher), and clients never authorized are
-- removed after a day; open authorization requests are capped per client and purged as soon as they expire; only
-- grants that reached a token are connections; a user found removed has their grant revoked, so being invited back
-- does not revive it; expired tokens are purged at every rotation.
ALTER TABLE app.mcp_client ADD COLUMN source_hash text;
CREATE INDEX mcp_client_source ON app.mcp_client(source_hash,created_at);
ALTER TABLE app.mcp_grant ADD COLUMN issued_at timestamptz;
DROP FUNCTION app.mcp_register_client(text,text,text[]);
CREATE FUNCTION app.mcp_register_client(p_id text,p_name text,p_uris text[],p_source text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM app.mcp_client c WHERE c.created_at<clock_timestamp()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM app.mcp_grant g WHERE g.client_id=c.id);
 IF p_source IS NOT NULL AND (SELECT count(*) FROM app.mcp_client WHERE source_hash=p_source AND created_at>clock_timestamp()-interval '1 hour')>=20 THEN RETURN false;END IF;
 IF (SELECT count(*) FROM app.mcp_client WHERE created_at>clock_timestamp()-interval '1 hour')>=2000 THEN RETURN false;END IF;
 INSERT INTO app.mcp_client(id,name,redirect_uris,source_hash) VALUES(p_id,p_name,p_uris,p_source);RETURN true;
END $$;
-- 'ok' | 'unknown_client' | 'bad_redirect' | 'busy' (20 open requests for this client).
CREATE OR REPLACE FUNCTION app.mcp_start_request(p_id text,p_client text,p_redirect text,p_challenge text,p_scopes text[],p_state text,p_resource text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.mcp_client;
BEGIN
 SELECT * INTO c FROM app.mcp_client WHERE id=p_client FOR UPDATE;
 IF NOT FOUND THEN RETURN 'unknown_client';END IF;
 IF NOT p_redirect=ANY(c.redirect_uris) THEN RETURN 'bad_redirect';END IF;
 IF p_challenge IS NULL THEN RETURN 'ok';END IF;
 DELETE FROM app.mcp_auth_request WHERE expires_at<=clock_timestamp();
 IF (SELECT count(*) FROM app.mcp_auth_request WHERE client_id=p_client AND used_at IS NULL)>=20 THEN RETURN 'busy';END IF;
 INSERT INTO app.mcp_auth_request(id,client_id,redirect_uri,code_challenge,scopes,state,resource,expires_at) VALUES(p_id,p_client,p_redirect,p_challenge,p_scopes,p_state,p_resource,clock_timestamp()+interval '10 minutes');
 RETURN 'ok';
END $$;
CREATE OR REPLACE FUNCTION app.mcp_issue(p_grant text,p_access text,p_refresh text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 DELETE FROM app.mcp_token WHERE grant_id=p_grant AND expires_at<=clock_timestamp();
 UPDATE app.mcp_grant SET issued_at=coalesce(issued_at,clock_timestamp()) WHERE id=p_grant;
 INSERT INTO app.mcp_token(token_hash,kind,grant_id,expires_at) VALUES(p_access,'access',p_grant,clock_timestamp()+interval '15 minutes'),(p_refresh,'refresh',p_grant,clock_timestamp()+interval '7 days');
$$;
CREATE OR REPLACE FUNCTION app.mcp_resolve_token(p_hash text,p_resource text) RETURNS TABLE(workspace_id text,user_id text,role text,grant_id text,scopes text[],retry_after integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g app.mcp_grant;r text;
BEGIN
 SELECT gr.* INTO g FROM app.mcp_token t JOIN app.mcp_grant gr ON gr.id=t.grant_id
  WHERE t.token_hash=p_hash AND t.kind='access' AND t.expires_at>clock_timestamp() AND gr.revoked_at IS NULL AND gr.resource=p_resource FOR UPDATE OF gr;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT m.role INTO r FROM auth.member m WHERE m."organizationId"=g.workspace_id AND m."userId"=g.user_id AND m.role IN('owner','admin','operator');
 IF r IS NULL THEN PERFORM app.mcp_revoke_grant(g.id,'membership');RETURN QUERY SELECT g.workspace_id,g.user_id,NULL::text,g.id,g.scopes,0;RETURN;END IF;
 IF g.window_start IS NULL OR g.window_start<=clock_timestamp()-interval '1 minute' THEN
  UPDATE app.mcp_grant SET window_start=clock_timestamp(),window_count=1,last_used_at=clock_timestamp() WHERE id=g.id;
 ELSIF g.window_count>=120 THEN
  RETURN QUERY SELECT g.workspace_id,g.user_id,r,g.id,g.scopes,greatest(1,ceil(extract(epoch FROM g.window_start+interval '1 minute'-clock_timestamp()))::integer);RETURN;
 ELSE UPDATE app.mcp_grant SET window_count=window_count+1,last_used_at=clock_timestamp() WHERE id=g.id;END IF;
 RETURN QUERY SELECT g.workspace_id,g.user_id,r,g.id,g.scopes,0;
END $$;
-- A connection is a grant that reached a token and still has a live one (refresh lasts 7 days).
CREATE OR REPLACE FUNCTION app.list_mcp_connections() RETURNS TABLE(id text,client_name text,user_id text,user_name text,scopes text[],created_at timestamptz,last_used_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);me text:=app.current_role();
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'MCP_ACCESS';END IF;
 RETURN QUERY SELECT g.id,c.name,g.user_id,u.name,g.scopes,g.created_at,g.last_used_at FROM app.mcp_grant g JOIN app.mcp_client c ON c.id=g.client_id LEFT JOIN auth."user" u ON u.id=g.user_id
  WHERE g.workspace_id=ws AND g.revoked_at IS NULL AND g.issued_at IS NOT NULL AND EXISTS(SELECT 1 FROM app.mcp_token t WHERE t.grant_id=g.id AND t.expires_at>clock_timestamp())
   AND (me IN('owner','admin') OR g.user_id=uid) ORDER BY g.created_at DESC,g.id;
END $$;
REVOKE ALL ON FUNCTION app.mcp_register_client(text,text,text[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mcp_register_client(text,text,text[],text) TO cadence_app;
