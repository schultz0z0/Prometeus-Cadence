-- 07C.2c: Google Agenda with the customer's own Google account. Availability rules live on the connection;
-- a reservation is local first (one live row per slot start) and the remote event carries a deterministic id for reconciliation.
ALTER TABLE app.integration_connection DROP CONSTRAINT integration_connection_kind_check,
 ADD CONSTRAINT integration_connection_kind_check CHECK(kind IN('apollo','google-sheets','google-calendar'));
ALTER TABLE app.connector_oauth_attempt DROP CONSTRAINT connector_oauth_attempt_kind_check,
 ADD CONSTRAINT connector_oauth_attempt_kind_check CHECK(kind IN('google-sheets','google-calendar'));

CREATE TABLE app.calendar_reservation(
 workspace_id text NOT NULL,id text NOT NULL,connection_id text NOT NULL,lead_id text NOT NULL,request_id text NOT NULL,
 start_at timestamptz NOT NULL,end_at timestamptz NOT NULL CHECK(end_at>start_at),timezone text NOT NULL,event_id text NOT NULL CHECK(event_id ~ '^[a-v0-9]+$' AND length(event_id) BETWEEN 5 AND 1024),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','accepted','uncertain','cancelled','failed')),
 revision bigint NOT NULL DEFAULT 1,created_by text NOT NULL,last_error text CHECK(length(last_error)<=300),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,request_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES app.integration_connection(workspace_id,id) ON DELETE CASCADE
);
-- Two reservations of the same slot: the second hits this index and gets a conflict.
CREATE UNIQUE INDEX calendar_reservation_slot ON app.calendar_reservation(workspace_id,connection_id,start_at) WHERE state IN('prepared','accepted','uncertain');
ALTER TABLE app.calendar_reservation ENABLE ROW LEVEL SECURITY;ALTER TABLE app.calendar_reservation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.calendar_reservation FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing;
CREATE POLICY tenant_read ON app.calendar_reservation FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT(workspace_id,id,connection_id,lead_id,start_at,end_at,timezone,event_id,state,revision,last_error,created_at,updated_at) ON app.calendar_reservation TO cadence_app;

-- Reading availability and reserving: owner, admin or operator. Connecting and configuring stay with connector_actor().
CREATE FUNCTION app.calendar_actor() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r text:=app.lock_membership();
BEGIN
 IF r IS NULL OR r NOT IN('owner','admin','operator') THEN RAISE EXCEPTION 'CALENDAR_ACCESS';END IF;
 RETURN r;
END $$;
-- The tokens are returned for this request only; the caller decides which state it needs.
CREATE FUNCTION app.calendar_access() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.integration_connection;
BEGIN
 PERFORM app.calendar_actor();
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=current_setting('app.workspace_id',true) AND kind='google-calendar' AND state<>'revoked';
 IF NOT FOUND OR r.secret IS NULL THEN RAISE EXCEPTION 'CONNECTION_NOT_FOUND';END IF;
 RETURN jsonb_build_object('id',r.id,'revision',r.revision,'state',r.state,'config',r.config,'configRevision',r.config_revision,'attention',r.attention,'secret',r.secret);
END $$;
CREATE FUNCTION app.save_calendar_tokens(p_id text,p_revision bigint,p_secret jsonb,p_expires timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.calendar_actor();
 UPDATE app.integration_connection SET secret=p_secret,token_expires_at=p_expires
  WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_id AND kind='google-calendar' AND revision=p_revision AND state<>'revoked' AND secret IS NOT NULL;
 RETURN FOUND;
END $$;
CREATE FUNCTION app.calendar_attention(p_id text,p_revision bigint,p_attention text,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.calendar_actor();
 UPDATE app.integration_connection SET attention=p_attention,last_error=left(p_error,300)
  WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_id AND kind='google-calendar' AND revision=p_revision AND state<>'revoked';
END $$;
CREATE FUNCTION app.configure_calendar(p_id text,p_revision bigint,p_expected bigint,p_config jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.integration_connection;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=ws AND id=p_id AND kind='google-calendar' AND state<>'revoked' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_NOT_FOUND';END IF;
 IF r.revision<>p_revision OR r.config_revision<>p_expected THEN RAISE EXCEPTION 'CONNECTION_CONFLICT';END IF;
 UPDATE app.integration_connection SET config=p_config,config_revision=config_revision+1,state='ready',attention=NULL,last_error=NULL WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
 RETURN r.config_revision;
END $$;

CREATE FUNCTION app.begin_calendar_reservation(p_id text,p_conn text,p_conn_revision bigint,p_config_revision bigint,p_lead text,p_request text,p_start timestamptz,p_end timestamptz,p_tz text,p_event text,p_valid_until timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);c app.integration_connection;x app.calendar_reservation;l jsonb;
BEGIN
 PERFORM app.calendar_actor();
 SELECT payload INTO l FROM app.lead WHERE workspace_id=ws AND id=p_lead;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEAD_NOT_FOUND';END IF;
 -- Same request again: the stored reservation answers, so a retry never books twice.
 SELECT * INTO x FROM app.calendar_reservation WHERE workspace_id=ws AND request_id=p_request;
 IF FOUND THEN
  IF x.connection_id<>p_conn OR x.lead_id<>p_lead OR x.start_at<>p_start THEN RAISE EXCEPTION 'REQUEST_REUSED';END IF;
  RETURN to_jsonb(x)||jsonb_build_object('replay',true,'leadName',l->>'name','companyName',l->>'companyName');
 END IF;
 IF p_valid_until<clock_timestamp() THEN RAISE EXCEPTION 'SLOT_EXPIRED';END IF;
 SELECT * INTO c FROM app.integration_connection WHERE workspace_id=ws AND id=p_conn AND kind='google-calendar' FOR SHARE;
 IF NOT FOUND OR c.state<>'ready' OR c.revision<>p_conn_revision OR c.config_revision<>p_config_revision OR c.attention IS NOT NULL THEN RAISE EXCEPTION 'CONNECTION_CHANGED';END IF;
 -- shortcut: a hold that never confirmed within 10 minutes is released without asking Google; the re-read of free/busy before creating still protects the slot.
 UPDATE app.calendar_reservation SET state='failed',last_error='Não confirmada em 10 minutos.',revision=revision+1,updated_at=clock_timestamp()
  WHERE workspace_id=ws AND connection_id=p_conn AND start_at=p_start AND state IN('prepared','uncertain') AND updated_at<clock_timestamp()-interval '10 minutes';
 BEGIN
  INSERT INTO app.calendar_reservation(workspace_id,id,connection_id,lead_id,request_id,start_at,end_at,timezone,event_id,created_by)
   VALUES(ws,p_id,p_conn,p_lead,p_request,p_start,p_end,p_tz,p_event,current_setting('app.user_id',true)) RETURNING * INTO x;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'SLOT_TAKEN';END;
 RETURN to_jsonb(x)||jsonb_build_object('replay',false,'leadName',l->>'name','companyName',l->>'companyName');
END $$;
CREATE FUNCTION app.finish_calendar_reservation(p_id text,p_revision bigint,p_state text,p_error text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v bigint;
BEGIN
 PERFORM app.calendar_actor();
 IF p_state NOT IN('accepted','uncertain','cancelled','failed') THEN RAISE EXCEPTION 'INTEGRATION_INVALID';END IF;
 UPDATE app.calendar_reservation SET state=p_state,last_error=left(p_error,300),revision=revision+1,updated_at=clock_timestamp()
  WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_id AND revision=p_revision RETURNING revision INTO v;
 IF v IS NULL THEN RAISE EXCEPTION 'RESERVATION_CHANGED';END IF;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION app.calendar_actor(),app.calendar_access(),app.save_calendar_tokens(text,bigint,jsonb,timestamptz),app.calendar_attention(text,bigint,text,text),
 app.configure_calendar(text,bigint,bigint,jsonb),app.begin_calendar_reservation(text,text,bigint,bigint,text,text,timestamptz,timestamptz,text,text,timestamptz),app.finish_calendar_reservation(text,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.calendar_actor(),app.calendar_access(),app.save_calendar_tokens(text,bigint,jsonb,timestamptz),app.calendar_attention(text,bigint,text,text),
 app.configure_calendar(text,bigint,bigint,jsonb),app.begin_calendar_reservation(text,text,bigint,bigint,text,text,timestamptz,timestamptz,text,text,timestamptz),app.finish_calendar_reservation(text,bigint,text,text) TO cadence_app;
