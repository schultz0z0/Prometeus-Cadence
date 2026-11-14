-- WhatsApp stamps messages a few seconds ahead of this server; such inbound messages never opened the 24 h service window.
-- Accept up to 2 minutes ahead (the OpenWA recovery tolerance) and record the server time instead of a future instant.
CREATE OR REPLACE FUNCTION app.channel_conversation_window_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.direction='inbound' AND NEW.occurred_at IS NOT NULL AND NEW.occurred_at<=clock_timestamp()+interval '2 minutes' THEN
  UPDATE app.channel_conversation SET last_inbound_at=GREATEST(last_inbound_at,LEAST(NEW.occurred_at,clock_timestamp()))
  WHERE workspace_id=NEW.workspace_id AND id=NEW.conversation_id AND sender_id=NEW.sender_id AND identity_id=NEW.identity_id;
 END IF;
 RETURN NEW;
END $$;
UPDATE app.channel_conversation v SET last_inbound_at=GREATEST(v.last_inbound_at,x.at) FROM (
 SELECT workspace_id,conversation_id,max(LEAST(occurred_at,created_at)) AS at FROM app.channel_message
 WHERE direction='inbound' AND occurred_at<=created_at+interval '2 minutes' GROUP BY workspace_id,conversation_id
) x WHERE v.workspace_id=x.workspace_id AND v.id=x.conversation_id;
