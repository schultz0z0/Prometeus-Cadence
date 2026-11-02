-- 06F.2: assistant proposals (closed allowlist, owner-only, expiring) and explicit onboarding progress per user.
CREATE TABLE app.assistant_proposal(
 workspace_id text NOT NULL,user_id text NOT NULL,id text NOT NULL DEFAULT gen_random_uuid()::text,request_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN('create-audience-automation','create-cadence','qualify-list','draft-reply')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND length(payload::text)<=8000),summary text NOT NULL CHECK(length(summary) BETWEEN 1 AND 300),
 state text NOT NULL DEFAULT 'proposed' CHECK(state IN('proposed','confirmed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',
 confirm_request_id text,entity_id text,href text CHECK(href IS NULL OR (href LIKE '/%' AND href NOT LIKE '//%')),decided_at timestamptz,
 PRIMARY KEY(workspace_id,user_id,id),UNIQUE(workspace_id,user_id,request_id),
 FOREIGN KEY(workspace_id,user_id,request_id,role_ref) REFERENCES app.assistant_message(workspace_id,user_id,request_id,role) ON DELETE CASCADE,
 role_ref text NOT NULL DEFAULT 'assistant' CHECK(role_ref='assistant')
);
CREATE TABLE app.onboarding_progress(
 workspace_id text NOT NULL REFERENCES auth.organization(id),user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
 item text NOT NULL CHECK(item ~ '^tour:(overview|dashboard|contacts|generator|cadences|executions|messages|automations|reports|settings)$'),
 completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,user_id,item)
);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['assistant_proposal','onboarding_progress'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
 EXECUTE format('CREATE POLICY own_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND user_id=current_setting(''app.user_id'',true) AND app.current_role() IS NOT NULL)',t);
END LOOP;END $$;
GRANT SELECT ON app.assistant_proposal,app.onboarding_progress TO cadence_app;

-- Stored with the answer that proposed it; the service has already validated kind, payload and catalog references.
CREATE FUNCTION app.assistant_propose(p_request text,p_kind text,p_payload jsonb,p_summary text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);v text;
BEGIN
 IF app.lock_membership() IS NULL THEN RAISE EXCEPTION 'ASSISTANT_ACCESS';END IF;
 INSERT INTO app.assistant_proposal(workspace_id,user_id,request_id,kind,payload,summary) VALUES(ws,uid,p_request,p_kind,p_payload,p_summary) ON CONFLICT(workspace_id,user_id,request_id) DO NOTHING;
 SELECT id INTO v FROM app.assistant_proposal WHERE workspace_id=ws AND user_id=uid AND request_id=p_request;RETURN v;
END $$;
-- Locks the caller's own live proposal for prepare/confirm; another user's id is simply not found.
CREATE FUNCTION app.assistant_proposal_lock(p_id text,p_for_confirm boolean) RETURNS app.assistant_proposal
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);r app.assistant_proposal;
BEGIN
 IF app.lock_membership() IS NULL THEN RAISE EXCEPTION 'ASSISTANT_ACCESS';END IF;
 SELECT * INTO r FROM app.assistant_proposal WHERE workspace_id=ws AND user_id=uid AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PROPOSAL_NOT_FOUND';END IF;
 IF r.state='cancelled' THEN RAISE EXCEPTION 'PROPOSAL_CANCELLED';END IF;
 IF r.state='confirmed' AND NOT p_for_confirm THEN RAISE EXCEPTION 'PROPOSAL_DONE';END IF;
 IF r.state='proposed' AND r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'PROPOSAL_EXPIRED';END IF;
 RETURN r;
END $$;
-- One confirmation id per proposal: a second id waits out or fails, so two clicks never create two jobs or drafts.
CREATE FUNCTION app.assistant_proposal_claim(p_id text,p_request text) RETURNS app.assistant_proposal
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);r app.assistant_proposal;
BEGIN
 r:=app.assistant_proposal_lock(p_id,true);
 IF r.confirm_request_id IS NOT NULL AND r.confirm_request_id<>p_request THEN RAISE EXCEPTION 'PROPOSAL_BUSY';END IF;
 IF r.state='proposed' THEN UPDATE app.assistant_proposal SET confirm_request_id=p_request WHERE workspace_id=ws AND user_id=uid AND id=p_id RETURNING * INTO r;END IF;
 RETURN r;
END $$;
-- A confirmation refused by the underlying service (expired review, changed base) frees the proposal for a new review.
CREATE FUNCTION app.assistant_proposal_release(p_id text,p_request text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE app.assistant_proposal SET confirm_request_id=NULL WHERE workspace_id=current_setting('app.workspace_id',true) AND user_id=current_setting('app.user_id',true) AND id=p_id AND state='proposed' AND confirm_request_id=p_request AND app.current_role() IS NOT NULL
$$;
CREATE FUNCTION app.assistant_proposal_finish(p_id text,p_state text,p_request text,p_entity text,p_href text) RETURNS app.assistant_proposal
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);r app.assistant_proposal;
BEGIN
 IF p_state NOT IN('confirmed','cancelled') THEN RAISE EXCEPTION 'PROPOSAL_INVALID';END IF;
 r:=app.assistant_proposal_lock(p_id,p_state='confirmed');
 IF r.state='confirmed' THEN IF r.confirm_request_id<>p_request THEN RAISE EXCEPTION 'PROPOSAL_DONE';END IF;RETURN r;END IF;
 IF p_state='confirmed' AND r.confirm_request_id IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'PROPOSAL_BUSY';END IF;
 IF p_state='cancelled' AND r.confirm_request_id IS NOT NULL THEN RAISE EXCEPTION 'PROPOSAL_BUSY';END IF;
 UPDATE app.assistant_proposal SET state=p_state,confirm_request_id=coalesce(p_request,confirm_request_id),entity_id=p_entity,href=p_href,decided_at=clock_timestamp()
  WHERE workspace_id=ws AND user_id=uid AND id=p_id RETURNING * INTO r;
 RETURN r;
END $$;
CREATE FUNCTION app.mark_onboarding(p_item text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.lock_membership() IS NULL THEN RAISE EXCEPTION 'ASSISTANT_ACCESS';END IF;
 INSERT INTO app.onboarding_progress(workspace_id,user_id,item) VALUES(current_setting('app.workspace_id',true),current_setting('app.user_id',true),p_item) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION app.assistant_propose(text,text,jsonb,text),app.assistant_proposal_lock(text,boolean),app.assistant_proposal_claim(text,text),app.assistant_proposal_release(text,text),app.assistant_proposal_finish(text,text,text,text,text),app.mark_onboarding(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assistant_propose(text,text,jsonb,text),app.assistant_proposal_lock(text,boolean),app.assistant_proposal_claim(text,text),app.assistant_proposal_release(text,text),app.assistant_proposal_finish(text,text,text,text,text),app.mark_onboarding(text) TO cadence_app;
