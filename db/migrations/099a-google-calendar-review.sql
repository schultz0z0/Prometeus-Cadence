-- 07C.2c review: a repeat claims its uncertain reservation before calling Google, a cancel cannot slip in meanwhile,
-- reconnecting clears any calendar attention, reservations move only along their state machine, and live holds never overlap.

-- New tokens for the live connection; a calendar reconnect clears every attention (the page sends lost-calendar cases here too).
CREATE OR REPLACE FUNCTION app.save_oauth_connection(p_id text,p_kind text,p_name text,p_secret jsonb,p_caps text[],p_expected bigint,p_expires timestamptz) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.integration_connection;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=ws AND kind=p_kind AND state<>'revoked' FOR UPDATE;
 IF FOUND THEN
  IF r.id<>p_id OR r.revision<>p_expected THEN RAISE EXCEPTION 'CONNECTION_CONFLICT';END IF;
  UPDATE app.integration_connection SET name=p_name,secret=p_secret,token_expires_at=p_expires,verified_at=clock_timestamp(),last_error=NULL,revision=revision+1,
   state=CASE WHEN config IS NULL THEN 'setup' ELSE 'ready' END,
   attention=CASE WHEN p_kind='google-calendar' OR attention IN('reconnect','forbidden') THEN NULL ELSE attention END
   WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
  IF r.attention IS NULL THEN UPDATE app.sheet_export SET state='pending',next_at=clock_timestamp() WHERE workspace_id=ws AND connection_id=p_id AND state='held';END IF;
 ELSE
  IF p_expected<>0 THEN RAISE EXCEPTION 'CONNECTION_CONFLICT';END IF;
  INSERT INTO app.integration_connection(workspace_id,id,kind,name,state,secret,capabilities,created_by,verified_at,token_expires_at)
   VALUES(ws,p_id,p_kind,p_name,'setup',p_secret,p_caps,current_setting('app.user_id',true),clock_timestamp(),p_expires) RETURNING * INTO r;
 END IF;
 RETURN r.revision;
END $$;

CREATE OR REPLACE FUNCTION app.begin_calendar_reservation(p_id text,p_conn text,p_conn_revision bigint,p_config_revision bigint,p_lead text,p_request text,p_start timestamptz,p_end timestamptz,p_tz text,p_event text,p_valid_until timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);c app.integration_connection;x app.calendar_reservation;l jsonb;
BEGIN
 PERFORM app.calendar_actor();
 -- One reservation decision at a time per connection: the overlap check below cannot race.
 PERFORM pg_advisory_xact_lock(hashtextextended(ws||':calendar:'||p_conn,0));
 SELECT payload INTO l FROM app.lead WHERE workspace_id=ws AND id=p_lead;
 -- Same request again: the stored reservation answers (even if the lead was deleted since), so a retry never books twice.
 SELECT * INTO x FROM app.calendar_reservation WHERE workspace_id=ws AND request_id=p_request FOR UPDATE;
 IF FOUND THEN
  IF x.connection_id<>p_conn OR x.lead_id<>p_lead OR x.start_at<>p_start THEN RAISE EXCEPTION 'REQUEST_REUSED';END IF;
  -- An unconfirmed repeat claims the row (uncertain -> prepared) so a cancel or another repeat waits for it.
  IF x.state='prepared' AND x.updated_at>clock_timestamp()-interval '10 minutes' THEN RAISE EXCEPTION 'RESERVATION_PENDING';END IF;
  IF x.state IN('prepared','uncertain') THEN
   UPDATE app.calendar_reservation SET state='prepared',revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=x.id RETURNING * INTO x;
  END IF;
  RETURN to_jsonb(x)||jsonb_build_object('replay',true,'leadName',l->>'name','companyName',l->>'companyName');
 END IF;
 IF l IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND';END IF;
 IF p_valid_until<clock_timestamp() THEN RAISE EXCEPTION 'SLOT_EXPIRED';END IF;
 SELECT * INTO c FROM app.integration_connection WHERE workspace_id=ws AND id=p_conn AND kind='google-calendar' FOR SHARE;
 IF NOT FOUND OR c.state<>'ready' OR c.revision<>p_conn_revision OR c.config_revision<>p_config_revision OR c.attention IS NOT NULL THEN RAISE EXCEPTION 'CONNECTION_CHANGED';END IF;
 -- shortcut: a hold that never confirmed within 10 minutes is released without asking Google; the re-read of free/busy before creating still protects the slot.
 UPDATE app.calendar_reservation SET state='failed',last_error='Não confirmada em 10 minutos.',revision=revision+1,updated_at=clock_timestamp()
  WHERE workspace_id=ws AND connection_id=p_conn AND start_at<p_end AND end_at>p_start AND state IN('prepared','uncertain') AND updated_at<clock_timestamp()-interval '10 minutes';
 -- Slots from different durations may overlap without sharing a start.
 IF EXISTS(SELECT 1 FROM app.calendar_reservation WHERE workspace_id=ws AND connection_id=p_conn AND start_at<p_end AND end_at>p_start AND state IN('prepared','accepted','uncertain')) THEN RAISE EXCEPTION 'SLOT_TAKEN';END IF;
 BEGIN
  INSERT INTO app.calendar_reservation(workspace_id,id,connection_id,lead_id,request_id,start_at,end_at,timezone,event_id,created_by)
   VALUES(ws,p_id,p_conn,p_lead,p_request,p_start,p_end,p_tz,p_event,current_setting('app.user_id',true)) RETURNING * INTO x;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'SLOT_TAKEN';END;
 RETURN to_jsonb(x)||jsonb_build_object('replay',false,'leadName',l->>'name','companyName',l->>'companyName');
END $$;

-- Reservations move only forward: an in-flight attempt settles, a booked or uncertain one is cancelled.
CREATE OR REPLACE FUNCTION app.finish_calendar_reservation(p_id text,p_revision bigint,p_state text,p_error text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x app.calendar_reservation;v bigint;
BEGIN
 PERFORM app.calendar_actor();
 SELECT * INTO x FROM app.calendar_reservation WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_id FOR UPDATE;
 IF NOT FOUND OR x.revision<>p_revision OR NOT((x.state='prepared' AND p_state IN('accepted','uncertain','failed')) OR (x.state IN('accepted','uncertain') AND p_state='cancelled')) THEN RAISE EXCEPTION 'RESERVATION_CHANGED';END IF;
 UPDATE app.calendar_reservation SET state=p_state,last_error=left(p_error,300),revision=revision+1,updated_at=clock_timestamp()
  WHERE workspace_id=x.workspace_id AND id=p_id RETURNING revision INTO v;
 RETURN v;
END $$;
