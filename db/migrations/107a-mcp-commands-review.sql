-- 07C.3b review. A proposal must have exactly one origin (NULL/NULL no longer passes); MCP proposals go away with
-- their connection or their user; revoking a connection cancels what it left open; the database itself requires
-- actions.prepare to propose and drops actions.confirm granted without it; the old consent signature stays as a
-- wrapper that never grants the opt-in confirm.
ALTER TABLE app.assistant_proposal DROP CONSTRAINT assistant_proposal_origin,
 ADD CONSTRAINT assistant_proposal_origin CHECK((grant_id IS NULL AND role_ref IS NOT DISTINCT FROM 'assistant') OR (grant_id IS NOT NULL AND role_ref IS NULL)),
 ADD CONSTRAINT assistant_proposal_grant_fk FOREIGN KEY(grant_id) REFERENCES app.mcp_grant(id) ON DELETE CASCADE,
 ADD CONSTRAINT assistant_proposal_user_fk FOREIGN KEY(user_id) REFERENCES auth."user"(id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION app.mcp_revoke_grant(p_grant text,p_reason text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE app.mcp_grant SET revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_reason=coalesce(revoked_reason,p_reason) WHERE id=p_grant;
 DELETE FROM app.mcp_token WHERE grant_id=p_grant;
 -- A confirmation already claimed finishes on its own path; only untouched proposals are cancelled.
 UPDATE app.assistant_proposal SET state='cancelled',decided_at=clock_timestamp() WHERE grant_id=p_grant AND state='proposed' AND confirm_request_id IS NULL;
$$;
CREATE OR REPLACE FUNCTION app.mcp_propose(p_grant text,p_kind text,p_payload jsonb,p_summary text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);v text;
BEGIN
 IF app.lock_membership() IS NULL THEN RAISE EXCEPTION 'ASSISTANT_ACCESS';END IF;
 PERFORM 1 FROM app.mcp_grant WHERE id=p_grant AND workspace_id=ws AND user_id=uid AND revoked_at IS NULL AND 'actions.prepare'=ANY(scopes) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ASSISTANT_ACCESS';END IF;
 IF (SELECT count(*) FROM app.assistant_proposal WHERE workspace_id=ws AND user_id=uid AND grant_id=p_grant AND state='proposed' AND expires_at>clock_timestamp())>=20 THEN RAISE EXCEPTION 'PROPOSAL_LIMIT';END IF;
 INSERT INTO app.assistant_proposal(workspace_id,user_id,request_id,kind,payload,summary,grant_id,role_ref)
  VALUES(ws,uid,gen_random_uuid()::text,p_kind,p_payload,p_summary,p_grant,NULL) RETURNING id INTO v;
 RETURN v;
END $$;
CREATE OR REPLACE FUNCTION app.mcp_decide(p_id text,p_allow boolean,p_grant text,p_code_hash text,p_scopes text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);r app.mcp_auth_request;chosen text[];
BEGIN
 IF app.current_role() IS NULL THEN RAISE EXCEPTION 'MCP_ACCESS';END IF;
 SELECT * INTO r FROM app.mcp_auth_request WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MCP_REQUEST_NOT_FOUND';END IF;
 IF r.used_at IS NOT NULL THEN RAISE EXCEPTION 'MCP_REQUEST_USED';END IF;
 IF r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'MCP_REQUEST_EXPIRED';END IF;
 chosen:=ARRAY(SELECT s FROM unnest(r.scopes) s WHERE p_scopes IS NULL OR s=ANY(p_scopes));
 IF NOT 'actions.prepare'=ANY(chosen) THEN chosen:=array_remove(chosen,'actions.confirm');END IF;
 IF p_allow AND cardinality(chosen)=0 THEN RAISE EXCEPTION 'MCP_SCOPE_EMPTY';END IF;
 UPDATE app.mcp_auth_request SET used_at=clock_timestamp() WHERE id=p_id;
 IF p_allow THEN
  INSERT INTO app.mcp_grant(workspace_id,id,client_id,user_id,scopes,resource) VALUES(ws,p_grant,r.client_id,uid,chosen,r.resource);
  INSERT INTO app.mcp_auth_code(code_hash,grant_id,client_id,redirect_uri,code_challenge,resource,expires_at) VALUES(p_code_hash,p_grant,r.client_id,r.redirect_uri,r.code_challenge,r.resource,clock_timestamp()+interval '60 seconds');
 END IF;
 RETURN jsonb_build_object('redirectUri',r.redirect_uri,'state',r.state);
END $$;
-- Compatibility for code still calling the 07C.3a signature during a deploy: everything but the opt-in confirm.
CREATE FUNCTION app.mcp_decide(p_id text,p_allow boolean,p_grant text,p_code_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.mcp_decide(p_id,p_allow,p_grant,p_code_hash,ARRAY['contacts.read','jobs.read','metrics.read','messages.read','actions.prepare']);
$$;
REVOKE ALL ON FUNCTION app.mcp_decide(text,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mcp_decide(text,boolean,text,text) TO cadence_app;
