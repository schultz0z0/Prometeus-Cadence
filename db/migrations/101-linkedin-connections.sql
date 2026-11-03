-- 07A.1: the customer's own LinkedIn account through the platform's account connector (Unipile).
-- The vendor holds the LinkedIn session; we keep only its account id. One live account per workspace, and a vendor
-- account or a LinkedIn member never serves two workspaces at once. Revoked rows stay as history.
CREATE TABLE app.linkedin_account(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,
 external_account_id text NOT NULL CHECK(external_account_id ~ '^[A-Za-z0-9_-]{6,64}$'),
 external_member_id text NOT NULL CHECK(length(external_member_id) BETWEEN 1 AND 200),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
 state text NOT NULL CHECK(state IN('connecting','ready','restricted','revoked','error')),
 capabilities_version text NOT NULL,credential_epoch bigint NOT NULL DEFAULT 1,revision bigint NOT NULL DEFAULT 1,
 last_sync_at timestamptz,next_sync_at timestamptz NOT NULL,sync_failures integer NOT NULL DEFAULT 0,
 sync_token text,sync_lease_until timestamptz,last_sync_request text,last_error text CHECK(length(last_error)<=300),
 remote_delete_pending boolean NOT NULL DEFAULT false,
 terms_version text NOT NULL,terms_accepted_by text NOT NULL,terms_accepted_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),revoked_at timestamptz,
 PRIMARY KEY(workspace_id,id)
);
CREATE UNIQUE INDEX linkedin_account_live ON app.linkedin_account(workspace_id) WHERE state<>'revoked';
CREATE UNIQUE INDEX linkedin_account_vendor ON app.linkedin_account(external_account_id) WHERE state<>'revoked';
CREATE UNIQUE INDEX linkedin_account_member ON app.linkedin_account(external_member_id) WHERE state<>'revoked';
CREATE INDEX linkedin_account_due ON app.linkedin_account(next_sync_at) WHERE state<>'revoked' OR remote_delete_pending;
-- Hosted login: bound to user, session and workspace; only hashes of the browser state and the notify token are kept.
CREATE TABLE app.linkedin_connect_attempt(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,user_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN('create','reconnect')),account_id text NOT NULL,
 state_hash text NOT NULL,session_hash text NOT NULL,notify_hash text NOT NULL,terms_version text NOT NULL,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 cancelled_at timestamptz,returned_at timestamptz,bound_at timestamptz,bound_external text,
 PRIMARY KEY(workspace_id,id)
);
CREATE UNIQUE INDEX linkedin_attempt_state ON app.linkedin_connect_attempt(state_hash);
CREATE UNIQUE INDEX linkedin_attempt_notify ON app.linkedin_connect_attempt(notify_hash);
-- remote_id is stable per fact (attempt, epoch transition), so a replay never adds a second row.
CREATE TABLE app.linkedin_account_event(
 workspace_id text NOT NULL,account_id text NOT NULL,remote_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN('connected','reconnected','status','revoked')),state text,actor text,at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,account_id,remote_id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES app.linkedin_account(workspace_id,id) ON DELETE CASCADE
);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['linkedin_account','linkedin_connect_attempt','linkedin_account_event'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
END LOOP;END $$;
CREATE POLICY tenant_read ON app.linkedin_account FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT(workspace_id,id,display_name,state,capabilities_version,revision,last_sync_at,next_sync_at,sync_failures,last_error,remote_delete_pending,created_at,revoked_at) ON app.linkedin_account TO cadence_app;
CREATE POLICY tenant_read ON app.linkedin_account_event FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
GRANT SELECT(workspace_id,account_id,kind,state,at) ON app.linkedin_account_event TO cadence_app;

-- 07A.0 read the gate only with a member in context, so the worker and the vendor notify (no member) never saw it.
CREATE OR REPLACE FUNCTION app.linkedin_capability_state() RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('adapterId',l.adapter_id,'kind',l.kind,'capabilities',l.capabilities,'expiresAt',l.expires_at,'verifiedAt',l.verified_at,'revision',l.revision,
  'state',CASE WHEN l.revoked_at IS NOT NULL THEN 'revoked' WHEN l.expires_at<=clock_timestamp() THEN 'expired' ELSE 'active' END)
 FROM app.linkedin_capability_profile l WHERE app.current_role() IS NOT NULL OR session_user IN('cadence_worker','cadence_ingress')
 ORDER BY (l.revoked_at IS NULL) DESC,l.updated_at DESC LIMIT 1
$$;
CREATE FUNCTION app.linkedin_backoff(p_failures integer) RETURNS interval LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN p_failures<=0 THEN interval '6 hours' ELSE least(interval '6 hours',make_interval(secs=>300*power(2,least(p_failures-1,10)))) END
$$;
-- Owner/admin. A new attempt cancels the open ones, so only the latest hosted login can bind.
CREATE FUNCTION app.begin_linkedin_connect(p_id text,p_kind text,p_account text,p_state text,p_session text,p_notify text,p_terms text,p_expected bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.linkedin_account;v timestamptz:=clock_timestamp()+interval '30 minutes';
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=ws AND state<>'revoked' FOR UPDATE;
 IF p_kind='create' THEN
  IF FOUND THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_EXISTS';END IF;
 ELSIF p_kind='reconnect' THEN
  IF NOT FOUND OR a.id<>p_account THEN RAISE EXCEPTION 'LINKEDIN_NOT_FOUND';END IF;
  IF a.revision<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 ELSE RAISE EXCEPTION 'LINKEDIN_NOT_FOUND';END IF;
 UPDATE app.linkedin_connect_attempt SET cancelled_at=clock_timestamp() WHERE workspace_id=ws AND bound_at IS NULL AND cancelled_at IS NULL;
 DELETE FROM app.linkedin_connect_attempt WHERE workspace_id=ws AND created_at<clock_timestamp()-interval '1 day';
 INSERT INTO app.linkedin_connect_attempt(workspace_id,id,user_id,kind,account_id,state_hash,session_hash,notify_hash,terms_version,expires_at)
  VALUES(ws,p_id,current_setting('app.user_id',true),p_kind,p_account,p_state,p_session,p_notify,p_terms,v);
 RETURN jsonb_build_object('kind',p_kind,'external',a.external_account_id,'expiresAt',v);
END $$;
-- The browser return proves nothing about the account; it only closes a cancelled or failed login.
CREATE FUNCTION app.return_linkedin_connect(p_state text,p_session text,p_failed boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.linkedin_connect_attempt;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO t FROM app.linkedin_connect_attempt WHERE workspace_id=current_setting('app.workspace_id',true) AND state_hash=p_state FOR UPDATE;
 IF NOT FOUND OR t.user_id<>current_setting('app.user_id',true) OR t.session_hash<>p_session THEN RAISE EXCEPTION 'OAUTH_INVALID';END IF;
 IF t.bound_at IS NOT NULL THEN RETURN 'connected';END IF;
 IF t.cancelled_at IS NOT NULL OR t.expires_at<=clock_timestamp() THEN RETURN 'cancelled';END IF;
 IF p_failed THEN UPDATE app.linkedin_connect_attempt SET cancelled_at=clock_timestamp() WHERE workspace_id=t.workspace_id AND id=t.id;RETURN 'cancelled';END IF;
 UPDATE app.linkedin_connect_attempt SET returned_at=clock_timestamp() WHERE workspace_id=t.workspace_id AND id=t.id;RETURN 'connecting';
END $$;
-- Ingress, no session: the attempt behind a notify token, so only a real attempt makes the server call the vendor.
CREATE FUNCTION app.linkedin_notify_attempt(p_notify text,p_name text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.linkedin_connect_attempt;ext text;
BEGIN
 SELECT * INTO t FROM app.linkedin_connect_attempt WHERE notify_hash=p_notify;
 IF NOT FOUND OR t.id<>p_name THEN RETURN NULL;END IF;
 SELECT external_account_id INTO ext FROM app.linkedin_account WHERE workspace_id=t.workspace_id AND id=t.account_id;
 RETURN jsonb_build_object('kind',t.kind,'external',ext,'boundExternal',t.bound_external,
  'closed',t.bound_at IS NULL AND (t.cancelled_at IS NOT NULL OR t.expires_at<=clock_timestamp()));
END $$;
-- Ingress. Re-checks the attempt, its author's role and the one-live-account rule in the binding transaction.
CREATE FUNCTION app.bind_linkedin_account(p_notify text,p_external text,p_member text,p_name text,p_state text,p_caps text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.linkedin_connect_attempt;a app.linkedin_account;r text;
BEGIN
 SELECT * INTO t FROM app.linkedin_connect_attempt WHERE notify_hash=p_notify FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_NOTIFY_INVALID';END IF;
 IF t.bound_at IS NOT NULL THEN IF t.bound_external=p_external THEN RETURN 'replay';END IF;RAISE EXCEPTION 'LINKEDIN_NOTIFY_USED';END IF;
 IF t.cancelled_at IS NOT NULL OR t.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'LINKEDIN_NOTIFY_USED';END IF;
 IF p_state NOT IN('connecting','ready','restricted','error') THEN RAISE EXCEPTION 'LINKEDIN_NOTIFY_INVALID';END IF;
 SELECT role INTO r FROM auth.member WHERE "organizationId"=t.workspace_id AND "userId"=t.user_id FOR SHARE;
 IF r IS NULL OR r NOT IN('owner','admin') THEN RAISE EXCEPTION 'LINKEDIN_AUTHOR_REMOVED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t.workspace_id||':connectors',0));
 SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=t.workspace_id AND state<>'revoked' FOR UPDATE;
 IF t.kind='create' THEN
  IF FOUND THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_EXISTS';END IF;
  BEGIN
   INSERT INTO app.linkedin_account(workspace_id,id,external_account_id,external_member_id,display_name,state,capabilities_version,last_sync_at,next_sync_at,terms_version,terms_accepted_by,terms_accepted_at)
    VALUES(t.workspace_id,t.account_id,p_external,p_member,p_name,p_state,p_caps,clock_timestamp(),clock_timestamp()+app.linkedin_backoff(0),t.terms_version,t.user_id,t.created_at);
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_TAKEN';
  END;
  INSERT INTO app.linkedin_account_event(workspace_id,account_id,remote_id,kind,state,actor) VALUES(t.workspace_id,t.account_id,'attempt:'||t.id,'connected',p_state,t.user_id);
 ELSE
  IF NOT FOUND OR a.id<>t.account_id THEN RAISE EXCEPTION 'LINKEDIN_NOTIFY_USED';END IF;
  IF a.external_account_id<>p_external THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_MISMATCH';END IF;
  BEGIN
   UPDATE app.linkedin_account SET state=p_state,display_name=p_name,external_member_id=p_member,capabilities_version=p_caps,credential_epoch=credential_epoch+1,revision=revision+1,
    last_sync_at=clock_timestamp(),next_sync_at=clock_timestamp()+app.linkedin_backoff(0),sync_failures=0,last_error=NULL,sync_token=NULL,sync_lease_until=NULL,
    terms_version=t.terms_version,terms_accepted_by=t.user_id,terms_accepted_at=t.created_at,updated_at=clock_timestamp()
    WHERE workspace_id=a.workspace_id AND id=a.id;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_TAKEN';
  END;
  INSERT INTO app.linkedin_account_event(workspace_id,account_id,remote_id,kind,state,actor) VALUES(t.workspace_id,t.account_id,'attempt:'||t.id,'reconnected',p_state,t.user_id);
 END IF;
 UPDATE app.linkedin_connect_attempt SET bound_at=clock_timestamp(),bound_external=p_external WHERE workspace_id=t.workspace_id AND id=t.id;
 RETURN 'bound';
END $$;
-- One check at a time per account (60 s lease); the same request id never repeats the vendor call.
CREATE FUNCTION app.claim_linkedin_sync(p_account text,p_request text,p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.linkedin_account;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_account FOR UPDATE;
 IF NOT FOUND OR a.state='revoked' THEN RAISE EXCEPTION 'LINKEDIN_NOT_FOUND';END IF;
 IF a.last_sync_request=p_request THEN RETURN jsonb_build_object('replay',true);END IF;
 IF a.sync_lease_until>clock_timestamp() THEN RAISE EXCEPTION 'LINKEDIN_SYNC_BUSY';END IF;
 UPDATE app.linkedin_account SET sync_token=p_token,sync_lease_until=clock_timestamp()+interval '60 seconds',last_sync_request=p_request WHERE workspace_id=a.workspace_id AND id=a.id;
 RETURN jsonb_build_object('replay',false,'external',a.external_account_id,'epoch',a.credential_epoch);
END $$;
-- Applies a check result; p_state NULL is a failed check (state and last check kept, backoff). A revoke or reconnect
-- during the I/O moved the epoch, so the result is dropped.
CREATE FUNCTION app.linkedin_sync_result(p_ws text,p_account text,p_token text,p_epoch bigint,p_state text,p_name text,p_error text,p_caps text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.linkedin_account;
BEGIN
 SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=p_ws AND id=p_account FOR UPDATE;
 IF NOT FOUND OR a.state='revoked' OR a.credential_epoch<>p_epoch THEN RETURN 'revoked';END IF;
 IF a.sync_token IS DISTINCT FROM p_token THEN RETURN 'lost';END IF;
 IF p_state IS NULL THEN
  UPDATE app.linkedin_account SET sync_failures=sync_failures+1,next_sync_at=clock_timestamp()+app.linkedin_backoff(sync_failures+1),last_error=left(p_error,300),
   sync_token=NULL,sync_lease_until=NULL,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_account;
  RETURN 'failed';
 END IF;
 IF p_state NOT IN('connecting','ready','restricted','error') THEN RAISE EXCEPTION 'LINKEDIN_NOTIFY_INVALID';END IF;
 IF a.state<>p_state THEN
  INSERT INTO app.linkedin_account_event(workspace_id,account_id,remote_id,kind,state) VALUES(p_ws,p_account,'status:'||a.credential_epoch||':'||a.revision,'status',p_state) ON CONFLICT DO NOTHING;
 END IF;
 UPDATE app.linkedin_account SET state=p_state,display_name=coalesce(p_name,display_name),capabilities_version=p_caps,last_sync_at=clock_timestamp(),
  next_sync_at=clock_timestamp()+app.linkedin_backoff(0),sync_failures=0,last_error=left(p_error,300),sync_token=NULL,sync_lease_until=NULL,
  revision=revision+CASE WHEN state<>p_state THEN 1 ELSE 0 END,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_account;
 RETURN 'saved';
END $$;
CREATE FUNCTION app.finish_linkedin_sync(p_account text,p_token text,p_epoch bigint,p_state text,p_name text,p_error text,p_caps text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM app.connector_actor();RETURN app.linkedin_sync_result(current_setting('app.workspace_id',true),p_account,p_token,p_epoch,p_state,p_name,p_error,p_caps);END $$;
-- Revoke is immediate: epoch moves (in-flight work drops its result), open logins close, history stays; the vendor session is removed after.
CREATE FUNCTION app.revoke_linkedin_account(p_account text,p_expected bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.linkedin_account;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=ws AND id=p_account FOR UPDATE;
 IF NOT FOUND OR a.state='revoked' THEN RAISE EXCEPTION 'LINKEDIN_NOT_FOUND';END IF;
 IF a.revision<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 UPDATE app.linkedin_account SET state='revoked',revoked_at=clock_timestamp(),credential_epoch=credential_epoch+1,revision=revision+1,remote_delete_pending=true,
  sync_token=NULL,sync_lease_until=NULL,sync_failures=0,next_sync_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_account;
 UPDATE app.linkedin_connect_attempt SET cancelled_at=clock_timestamp() WHERE workspace_id=ws AND bound_at IS NULL AND cancelled_at IS NULL;
 INSERT INTO app.linkedin_account_event(workspace_id,account_id,remote_id,kind,state,actor) VALUES(ws,p_account,'revoke:'||a.credential_epoch,'revoked','revoked',current_setting('app.user_id',true));
 RETURN a.external_account_id;
END $$;
CREATE FUNCTION app.linkedin_remote_deleted(p_account text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.connector_actor();
 UPDATE app.linkedin_account SET remote_delete_pending=false WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_account AND state='revoked';
END $$;
-- Worker: due health checks and pending vendor removals, leased for two minutes.
CREATE FUNCTION app.claim_linkedin_work(p_limit integer,p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE out jsonb;
BEGIN
 WITH due AS(SELECT workspace_id,id FROM app.linkedin_account WHERE next_sync_at<=clock_timestamp() AND (state<>'revoked' OR remote_delete_pending)
   AND (sync_lease_until IS NULL OR sync_lease_until<=clock_timestamp()) ORDER BY next_sync_at LIMIT least(greatest(p_limit,1),50) FOR UPDATE SKIP LOCKED),
  leased AS(UPDATE app.linkedin_account a SET sync_token=p_token,sync_lease_until=clock_timestamp()+interval '120 seconds' FROM due WHERE a.workspace_id=due.workspace_id AND a.id=due.id
   RETURNING a.workspace_id,a.id,a.external_account_id,a.credential_epoch,a.state)
 SELECT coalesce(jsonb_agg(jsonb_build_object('workspaceId',workspace_id,'id',id,'external',external_account_id,'epoch',credential_epoch,'kind',CASE WHEN state='revoked' THEN 'delete' ELSE 'sync' END)),'[]') INTO out FROM leased;
 RETURN out;
END $$;
CREATE FUNCTION app.finish_linkedin_work(p_ws text,p_account text,p_token text,p_epoch bigint,p_state text,p_name text,p_error text,p_caps text) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app.linkedin_sync_result(p_ws,p_account,p_token,p_epoch,p_state,p_name,p_error,p_caps) $$;
CREATE FUNCTION app.finish_linkedin_remote_delete(p_ws text,p_account text,p_token text,p_ok boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.linkedin_account SET remote_delete_pending=NOT p_ok,sync_failures=CASE WHEN p_ok THEN 0 ELSE sync_failures+1 END,
  next_sync_at=clock_timestamp()+app.linkedin_backoff(CASE WHEN p_ok THEN 0 ELSE sync_failures+1 END),sync_token=NULL,sync_lease_until=NULL
  WHERE workspace_id=p_ws AND id=p_account AND state='revoked' AND sync_token=p_token;
END $$;

REVOKE ALL ON FUNCTION app.linkedin_backoff(integer),app.begin_linkedin_connect(text,text,text,text,text,text,text,bigint),app.return_linkedin_connect(text,text,boolean),
 app.linkedin_notify_attempt(text,text),app.bind_linkedin_account(text,text,text,text,text,text),app.claim_linkedin_sync(text,text,text),
 app.linkedin_sync_result(text,text,text,bigint,text,text,text,text),app.finish_linkedin_sync(text,text,bigint,text,text,text,text),app.revoke_linkedin_account(text,bigint),
 app.linkedin_remote_deleted(text),app.claim_linkedin_work(integer,text),app.finish_linkedin_work(text,text,text,bigint,text,text,text,text),app.finish_linkedin_remote_delete(text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.begin_linkedin_connect(text,text,text,text,text,text,text,bigint),app.return_linkedin_connect(text,text,boolean),app.claim_linkedin_sync(text,text,text),
 app.finish_linkedin_sync(text,text,bigint,text,text,text,text),app.revoke_linkedin_account(text,bigint),app.linkedin_remote_deleted(text) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.linkedin_notify_attempt(text,text),app.bind_linkedin_account(text,text,text,text,text,text),app.linkedin_capability_state() TO cadence_ingress;
GRANT EXECUTE ON FUNCTION app.claim_linkedin_work(integer,text),app.finish_linkedin_work(text,text,text,bigint,text,text,text,text),app.finish_linkedin_remote_delete(text,text,text,boolean) TO cadence_worker;
