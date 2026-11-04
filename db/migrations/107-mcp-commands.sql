-- 07C.3b: MCP writes reuse the assistant's reviewed proposals. A proposal comes either from the chat (tied to its
-- answer) or from one MCP connection (grant); open ones per connection are capped. The consent records the scopes the
-- person ticked, within what the client asked.
ALTER TABLE app.assistant_proposal ADD COLUMN grant_id text,ALTER COLUMN role_ref DROP NOT NULL,DROP CONSTRAINT assistant_proposal_role_ref_check,
 ADD CONSTRAINT assistant_proposal_origin CHECK((grant_id IS NULL AND role_ref='assistant') OR (grant_id IS NOT NULL AND role_ref IS NULL));
CREATE INDEX assistant_proposal_grant ON app.assistant_proposal(grant_id,state) WHERE grant_id IS NOT NULL;
-- The service has validated kind, payload and that the reference exists in this workspace.
CREATE FUNCTION app.mcp_propose(p_grant text,p_kind text,p_payload jsonb,p_summary text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);v text;
BEGIN
 IF app.lock_membership() IS NULL THEN RAISE EXCEPTION 'ASSISTANT_ACCESS';END IF;
 PERFORM 1 FROM app.mcp_grant WHERE id=p_grant AND workspace_id=ws AND user_id=uid AND revoked_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ASSISTANT_ACCESS';END IF;
 IF (SELECT count(*) FROM app.assistant_proposal WHERE workspace_id=ws AND user_id=uid AND grant_id=p_grant AND state='proposed' AND expires_at>clock_timestamp())>=20 THEN RAISE EXCEPTION 'PROPOSAL_LIMIT';END IF;
 INSERT INTO app.assistant_proposal(workspace_id,user_id,request_id,kind,payload,summary,grant_id,role_ref)
  VALUES(ws,uid,gen_random_uuid()::text,p_kind,p_payload,p_summary,p_grant,NULL) RETURNING id INTO v;
 RETURN v;
END $$;
DROP FUNCTION app.mcp_decide(text,boolean,text,text);
-- p_scopes: what the person ticked, already intersected with the request by the service; NULL keeps the request.
CREATE FUNCTION app.mcp_decide(p_id text,p_allow boolean,p_grant text,p_code_hash text,p_scopes text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);r app.mcp_auth_request;chosen text[];
BEGIN
 IF app.current_role() IS NULL THEN RAISE EXCEPTION 'MCP_ACCESS';END IF;
 SELECT * INTO r FROM app.mcp_auth_request WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MCP_REQUEST_NOT_FOUND';END IF;
 IF r.used_at IS NOT NULL THEN RAISE EXCEPTION 'MCP_REQUEST_USED';END IF;
 IF r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'MCP_REQUEST_EXPIRED';END IF;
 chosen:=ARRAY(SELECT s FROM unnest(r.scopes) s WHERE p_scopes IS NULL OR s=ANY(p_scopes));
 IF p_allow AND cardinality(chosen)=0 THEN RAISE EXCEPTION 'MCP_SCOPE_EMPTY';END IF;
 UPDATE app.mcp_auth_request SET used_at=clock_timestamp() WHERE id=p_id;
 IF p_allow THEN
  INSERT INTO app.mcp_grant(workspace_id,id,client_id,user_id,scopes,resource) VALUES(ws,p_grant,r.client_id,uid,chosen,r.resource);
  INSERT INTO app.mcp_auth_code(code_hash,grant_id,client_id,redirect_uri,code_challenge,resource,expires_at) VALUES(p_code_hash,p_grant,r.client_id,r.redirect_uri,r.code_challenge,r.resource,clock_timestamp()+interval '60 seconds');
 END IF;
 RETURN jsonb_build_object('redirectUri',r.redirect_uri,'state',r.state);
END $$;
REVOKE ALL ON FUNCTION app.mcp_propose(text,text,jsonb,text),app.mcp_decide(text,boolean,text,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mcp_propose(text,text,jsonb,text),app.mcp_decide(text,boolean,text,text,text[]) TO cadence_app;
