-- 07A.1 review: a notify only verifies; the account binds when the starter's browser has also come back (a forwarded
-- hosted link cannot attach someone else's login). One lock order everywhere (member, workspace advisory lock, attempt,
-- account). Vendor sessions created by a rejected login are queued for removal. A reconnect keeps the same LinkedIn member.
ALTER TABLE app.linkedin_connect_attempt ADD COLUMN verified_external text,ADD COLUMN verified_member text,ADD COLUMN verified_name text,
 ADD COLUMN verified_state text,ADD COLUMN orphan_queued boolean NOT NULL DEFAULT false;
CREATE INDEX linkedin_attempt_unclaimed ON app.linkedin_connect_attempt(expires_at) WHERE verified_external IS NOT NULL AND bound_at IS NULL AND NOT orphan_queued;
-- Vendor accounts nobody owns; never one that is live or verified in an open attempt.
CREATE TABLE app.linkedin_orphan(external_account_id text PRIMARY KEY CHECK(external_account_id ~ '^[A-Za-z0-9_-]{6,64}$'),
 next_at timestamptz NOT NULL DEFAULT clock_timestamp(),failures integer NOT NULL DEFAULT 0,lease_token text,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE app.linkedin_orphan ENABLE ROW LEVEL SECURITY;ALTER TABLE app.linkedin_orphan FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.linkedin_orphan FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing;

CREATE FUNCTION app.linkedin_external_claimed(p_external text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.linkedin_account WHERE external_account_id=p_external AND (state<>'revoked' OR remote_delete_pending))
  OR EXISTS(SELECT 1 FROM app.linkedin_connect_attempt WHERE verified_external=p_external AND bound_at IS NULL AND cancelled_at IS NULL AND expires_at>clock_timestamp())
$$;
-- Binds a verified attempt. Callers hold the workspace advisory lock and the attempt row and checked its author.
CREATE FUNCTION app.linkedin_finalize(p_ws text,p_attempt text,p_caps text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.linkedin_connect_attempt;a app.linkedin_account;
BEGIN
 SELECT * INTO t FROM app.linkedin_connect_attempt WHERE workspace_id=p_ws AND id=p_attempt;
 IF p_caps IS NULL THEN RAISE EXCEPTION 'LINKEDIN_UNAVAILABLE';END IF;
 SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=p_ws AND state<>'revoked' FOR UPDATE;
 IF t.kind='create' THEN
  IF FOUND THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_EXISTS';END IF;
  BEGIN
   INSERT INTO app.linkedin_account(workspace_id,id,external_account_id,external_member_id,display_name,state,capabilities_version,last_sync_at,next_sync_at,terms_version,terms_accepted_by,terms_accepted_at)
    VALUES(p_ws,t.account_id,t.verified_external,t.verified_member,t.verified_name,t.verified_state,p_caps,clock_timestamp(),clock_timestamp()+app.linkedin_backoff(0),t.terms_version,t.user_id,t.created_at);
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_TAKEN';
  END;
  INSERT INTO app.linkedin_account_event(workspace_id,account_id,remote_id,kind,state,actor) VALUES(p_ws,t.account_id,'attempt:'||t.id,'connected',t.verified_state,t.user_id);
 ELSE
  IF NOT FOUND OR a.id<>t.account_id THEN RAISE EXCEPTION 'LINKEDIN_NOTIFY_USED';END IF;
  IF a.external_account_id<>t.verified_external OR a.external_member_id<>t.verified_member THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_MISMATCH';END IF;
  UPDATE app.linkedin_account SET state=t.verified_state,display_name=t.verified_name,capabilities_version=p_caps,credential_epoch=credential_epoch+1,revision=revision+1,
   last_sync_at=clock_timestamp(),next_sync_at=clock_timestamp()+app.linkedin_backoff(0),sync_failures=0,last_error=NULL,sync_token=NULL,sync_lease_until=NULL,
   terms_version=t.terms_version,terms_accepted_by=t.user_id,terms_accepted_at=t.created_at,updated_at=clock_timestamp()
   WHERE workspace_id=a.workspace_id AND id=a.id;
  INSERT INTO app.linkedin_account_event(workspace_id,account_id,remote_id,kind,state,actor) VALUES(p_ws,t.account_id,'attempt:'||t.id,'reconnected',t.verified_state,t.user_id);
 END IF;
 UPDATE app.linkedin_connect_attempt SET bound_at=clock_timestamp(),bound_external=t.verified_external WHERE workspace_id=p_ws AND id=t.id;
END $$;

DROP FUNCTION app.bind_linkedin_account(text,text,text,text,text,text);
-- Ingress. Records the vendor-confirmed account on the attempt; binds only if the starter's browser already came back.
CREATE FUNCTION app.bind_linkedin_account(p_notify text,p_external text,p_member text,p_name text,p_state text,p_caps text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.linkedin_connect_attempt;a app.linkedin_account;r text;
BEGIN
 SELECT * INTO t FROM app.linkedin_connect_attempt WHERE notify_hash=p_notify;
 IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_NOTIFY_INVALID';END IF;
 IF p_state NOT IN('connecting','ready','restricted','error') THEN RAISE EXCEPTION 'LINKEDIN_NOTIFY_INVALID';END IF;
 -- Same order as connector_actor(): member, then the workspace lock, then rows.
 SELECT role INTO r FROM auth.member WHERE "organizationId"=t.workspace_id AND "userId"=t.user_id FOR SHARE;
 IF r IS NULL OR r NOT IN('owner','admin') THEN RAISE EXCEPTION 'LINKEDIN_AUTHOR_REMOVED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t.workspace_id||':connectors',0));
 SELECT * INTO t FROM app.linkedin_connect_attempt WHERE workspace_id=t.workspace_id AND id=t.id FOR UPDATE;
 IF t.bound_at IS NOT NULL THEN IF t.bound_external=p_external THEN RETURN 'replay';END IF;RAISE EXCEPTION 'LINKEDIN_NOTIFY_USED';END IF;
 IF t.cancelled_at IS NOT NULL OR t.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'LINKEDIN_NOTIFY_USED';END IF;
 IF t.verified_external IS NOT NULL AND t.verified_external<>p_external THEN RAISE EXCEPTION 'LINKEDIN_NOTIFY_USED';END IF;
 IF EXISTS(SELECT 1 FROM app.linkedin_account WHERE (external_account_id=p_external OR external_member_id=p_member) AND state<>'revoked' AND (workspace_id<>t.workspace_id OR t.kind='create'))
  THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_TAKEN';END IF;
 IF t.kind='reconnect' THEN
  SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=t.workspace_id AND id=t.account_id AND state<>'revoked';
  IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_NOTIFY_USED';END IF;
  IF a.external_account_id<>p_external OR a.external_member_id<>p_member THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_MISMATCH';END IF;
 END IF;
 UPDATE app.linkedin_connect_attempt SET verified_external=p_external,verified_member=p_member,verified_name=p_name,verified_state=p_state WHERE workspace_id=t.workspace_id AND id=t.id;
 IF t.returned_at IS NULL THEN RETURN 'pending';END IF;
 PERFORM app.linkedin_finalize(t.workspace_id,t.id,p_caps);RETURN 'bound';
END $$;

DROP FUNCTION app.return_linkedin_connect(text,text,boolean);
-- The starter's browser: closes a failed login, or binds the vendor-confirmed account. p_caps NULL = gate off now.
CREATE FUNCTION app.return_linkedin_connect(p_state text,p_session text,p_failed boolean,p_caps text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.linkedin_connect_attempt;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO t FROM app.linkedin_connect_attempt WHERE workspace_id=current_setting('app.workspace_id',true) AND state_hash=p_state FOR UPDATE;
 IF NOT FOUND OR t.user_id<>current_setting('app.user_id',true) OR t.session_hash<>p_session THEN RAISE EXCEPTION 'OAUTH_INVALID';END IF;
 IF t.bound_at IS NOT NULL THEN RETURN 'connected';END IF;
 IF t.cancelled_at IS NOT NULL OR t.expires_at<=clock_timestamp() THEN RETURN 'cancelled';END IF;
 IF p_failed THEN UPDATE app.linkedin_connect_attempt SET cancelled_at=clock_timestamp() WHERE workspace_id=t.workspace_id AND id=t.id;RETURN 'cancelled';END IF;
 UPDATE app.linkedin_connect_attempt SET returned_at=coalesce(returned_at,clock_timestamp()) WHERE workspace_id=t.workspace_id AND id=t.id;
 IF t.verified_external IS NULL THEN RETURN 'connecting';END IF;
 PERFORM app.linkedin_finalize(t.workspace_id,t.id,p_caps);RETURN 'connected';
END $$;

CREATE OR REPLACE FUNCTION app.linkedin_notify_attempt(p_notify text,p_name text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.linkedin_connect_attempt;ext text;
BEGIN
 SELECT * INTO t FROM app.linkedin_connect_attempt WHERE notify_hash=p_notify;
 IF NOT FOUND OR t.id<>p_name THEN RETURN NULL;END IF;
 SELECT external_account_id INTO ext FROM app.linkedin_account WHERE workspace_id=t.workspace_id AND id=t.account_id;
 RETURN jsonb_build_object('kind',t.kind,'external',ext,'boundExternal',t.bound_external,
  'closed',t.bound_at IS NULL AND (t.cancelled_at IS NOT NULL OR t.expires_at<=clock_timestamp()));
END $$;
-- Ingress: queue a vendor account a rejected create login left behind. false = someone owns it; leave it alone.
CREATE FUNCTION app.linkedin_orphan_mark(p_external text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.linkedin_external_claimed(p_external) THEN RETURN false;END IF;
 INSERT INTO app.linkedin_orphan(external_account_id) VALUES(p_external) ON CONFLICT DO NOTHING;RETURN true;
END $$;
-- Removal confirmed (or the account is claimed after all): forget the row.
CREATE FUNCTION app.linkedin_orphan_done(p_external text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ DELETE FROM app.linkedin_orphan WHERE external_account_id=p_external $$;
-- Worker: verified logins that never came back become orphans; then lease the due ones still unclaimed.
CREATE FUNCTION app.claim_linkedin_orphans(p_limit integer,p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE out jsonb;
BEGIN
 WITH gone AS(UPDATE app.linkedin_connect_attempt SET orphan_queued=true WHERE verified_external IS NOT NULL AND bound_at IS NULL AND NOT orphan_queued
   AND (cancelled_at IS NOT NULL OR expires_at<=clock_timestamp()) RETURNING verified_external)
 INSERT INTO app.linkedin_orphan(external_account_id) SELECT DISTINCT verified_external FROM gone WHERE NOT app.linkedin_external_claimed(verified_external) ON CONFLICT DO NOTHING;
 DELETE FROM app.linkedin_orphan o WHERE app.linkedin_external_claimed(o.external_account_id);
 WITH due AS(SELECT external_account_id FROM app.linkedin_orphan WHERE next_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp())
   ORDER BY next_at LIMIT least(greatest(p_limit,1),50) FOR UPDATE SKIP LOCKED),
  leased AS(UPDATE app.linkedin_orphan o SET lease_token=p_token,lease_until=clock_timestamp()+interval '120 seconds' FROM due WHERE o.external_account_id=due.external_account_id RETURNING o.external_account_id)
 SELECT coalesce(jsonb_agg(external_account_id),'[]') INTO out FROM leased;
 RETURN out;
END $$;
CREATE FUNCTION app.finish_linkedin_orphan(p_external text,p_token text,p_ok boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_ok THEN DELETE FROM app.linkedin_orphan WHERE external_account_id=p_external AND lease_token=p_token;RETURN;END IF;
 UPDATE app.linkedin_orphan SET failures=failures+1,next_at=clock_timestamp()+app.linkedin_backoff(failures+1),lease_token=NULL,lease_until=NULL WHERE external_account_id=p_external AND lease_token=p_token;
END $$;

-- Results: 'changed' when a reconnect moved the epoch (not a revoke); a 429 waits at least its Retry-After.
DROP FUNCTION app.finish_linkedin_sync(text,text,bigint,text,text,text,text);
DROP FUNCTION app.finish_linkedin_work(text,text,text,bigint,text,text,text,text);
DROP FUNCTION app.linkedin_sync_result(text,text,text,bigint,text,text,text,text);
CREATE FUNCTION app.linkedin_sync_result(p_ws text,p_account text,p_token text,p_epoch bigint,p_state text,p_name text,p_error text,p_caps text,p_retry_ms bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.linkedin_account;
BEGIN
 SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=p_ws AND id=p_account FOR UPDATE;
 IF NOT FOUND OR a.state='revoked' THEN RETURN 'revoked';END IF;
 IF a.credential_epoch<>p_epoch THEN RETURN 'changed';END IF;
 IF a.sync_token IS DISTINCT FROM p_token THEN RETURN 'lost';END IF;
 IF p_state IS NULL THEN
  UPDATE app.linkedin_account SET sync_failures=sync_failures+1,
   next_sync_at=clock_timestamp()+greatest(app.linkedin_backoff(sync_failures+1),make_interval(secs=>least(coalesce(p_retry_ms,0),86400000)/1000.0)),
   last_error=left(p_error,300),sync_token=NULL,sync_lease_until=NULL,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_account;
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
CREATE FUNCTION app.finish_linkedin_sync(p_account text,p_token text,p_epoch bigint,p_state text,p_name text,p_error text,p_caps text,p_retry_ms bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM app.connector_actor();RETURN app.linkedin_sync_result(current_setting('app.workspace_id',true),p_account,p_token,p_epoch,p_state,p_name,p_error,p_caps,p_retry_ms);END $$;
CREATE FUNCTION app.finish_linkedin_work(p_ws text,p_account text,p_token text,p_epoch bigint,p_state text,p_name text,p_error text,p_caps text,p_retry_ms bigint) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app.linkedin_sync_result(p_ws,p_account,p_token,p_epoch,p_state,p_name,p_error,p_caps,p_retry_ms) $$;

REVOKE ALL ON FUNCTION app.linkedin_external_claimed(text),app.linkedin_finalize(text,text,text),app.bind_linkedin_account(text,text,text,text,text,text),
 app.return_linkedin_connect(text,text,boolean,text),app.linkedin_orphan_mark(text),app.linkedin_orphan_done(text),app.claim_linkedin_orphans(integer,text),
 app.finish_linkedin_orphan(text,text,boolean),app.linkedin_sync_result(text,text,text,bigint,text,text,text,text,bigint),
 app.finish_linkedin_sync(text,text,bigint,text,text,text,text,bigint),app.finish_linkedin_work(text,text,text,bigint,text,text,text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.return_linkedin_connect(text,text,boolean,text),app.finish_linkedin_sync(text,text,bigint,text,text,text,text,bigint) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.bind_linkedin_account(text,text,text,text,text,text),app.linkedin_orphan_mark(text),app.linkedin_orphan_done(text) TO cadence_ingress;
GRANT EXECUTE ON FUNCTION app.finish_linkedin_work(text,text,text,bigint,text,text,text,text,bigint),app.claim_linkedin_orphans(integer,text),app.finish_linkedin_orphan(text,text,boolean),app.linkedin_orphan_done(text) TO cadence_worker;
