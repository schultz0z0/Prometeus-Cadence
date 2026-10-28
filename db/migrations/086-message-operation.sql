-- Observation records reference the existing outbox. They grant no dispatch/receipt authority.
CREATE TABLE app.channel_pilot_observation(
 workspace_id text NOT NULL,request_id text NOT NULL,connection_id text NOT NULL,message_id text NOT NULL,
 connection_revision bigint NOT NULL,actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,request_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES app.channel_connection(workspace_id,id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES app.channel_message(workspace_id,id)
);
ALTER TABLE app.channel_pilot_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.channel_pilot_observation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON app.channel_pilot_observation FOR SELECT
 USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
GRANT SELECT ON app.channel_pilot_observation TO cadence_app;
CREATE INDEX channel_status_remote_time ON app.channel_status_evidence(workspace_id,connection_id,remote_id,occurred_at);
CREATE INDEX channel_reply_after ON app.channel_message(workspace_id,conversation_id,occurred_at) WHERE direction='inbound';

CREATE FUNCTION app.record_channel_pilot(p_request text,p_connection text,p_message text,p_revision bigint,p_recipient text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);actor text:=current_setting('app.user_id',true);prior app.channel_pilot_observation;
BEGIN
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 IF app.current_role() NOT IN('owner','admin') OR app.current_role() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF NOT EXISTS(SELECT 1 FROM app.channel_message m
  JOIN app.channel_connection c ON c.workspace_id=m.workspace_id AND c.id=m.connection_id
  JOIN app.channel_identity i ON i.workspace_id=m.workspace_id AND i.id=m.identity_id
  WHERE m.workspace_id=ws AND m.id=p_message AND c.id=p_connection AND c.revision=p_revision
   AND c.state='ready' AND m.direction='outbound' AND m.purpose='test'
   AND (i.external_id=p_recipient OR i.phone=p_recipient)) THEN RAISE EXCEPTION 'PILOT_CHANGED';END IF;
 SELECT * INTO prior FROM app.channel_pilot_observation WHERE workspace_id=ws AND request_id=p_request;
 IF FOUND THEN
  IF prior.connection_id<>p_connection OR prior.message_id<>p_message OR prior.connection_revision<>p_revision OR prior.actor_id<>actor THEN RAISE EXCEPTION 'PILOT_CHANGED';END IF;
  RETURN;
 END IF;
 INSERT INTO app.channel_pilot_observation(workspace_id,request_id,connection_id,message_id,connection_revision,actor_id)
 VALUES(ws,p_request,p_connection,p_message,p_revision,actor);
END $$;
REVOKE ALL ON FUNCTION app.record_channel_pilot(text,text,text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_channel_pilot(text,text,text,bigint,text) TO cadence_app;
