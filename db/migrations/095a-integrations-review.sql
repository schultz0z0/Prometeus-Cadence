-- 07C.1a review fixes. 095 is applied locally (checksummed); functions are replaced here.
CREATE INDEX integration_delivery_inflight ON app.integration_delivery(lease_until) WHERE state='delivering';
CREATE INDEX integration_event_age ON app.integration_event(occurred_at);

-- Emission never fails a domain write: an oversized payload becomes a reference, and any other error is dropped with a warning.
CREATE OR REPLACE FUNCTION app.emit_integration_event(p_ws text,p_type text,p_kind text,p_entity text,p_list text,p_channel text,p_data jsonb,p_only text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v text;d jsonb:=p_data;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.webhook_destination w WHERE w.workspace_id=p_ws AND w.active AND (p_only IS NULL OR w.id=p_only)
  AND (p_type='webhook.test' OR p_type=ANY(w.events) OR (p_type='lead.connected' AND ('lead.connected.'||lower(coalesce(p_channel,'')))=ANY(w.events)))
  AND (p_type='webhook.test' OR w.list_ids IS NULL OR p_list=ANY(w.list_ids))) THEN RETURN NULL;END IF;
 IF length(d::text)>200000 THEN d:=jsonb_build_object('lead',jsonb_build_object('id',p_entity),'list',d->'list','truncated',true);END IF;
 BEGIN
  INSERT INTO app.integration_event(workspace_id,type,entity_kind,entity_id,list_id,channel,data) VALUES(p_ws,p_type,p_kind,p_entity,p_list,p_channel,d) RETURNING id INTO v;
  INSERT INTO app.integration_delivery(workspace_id,destination_id,event_id,state)
   SELECT p_ws,w.id,v,CASE WHEN w.attention IS NULL THEN 'pending' ELSE 'held' END FROM app.webhook_destination w WHERE w.workspace_id=p_ws AND w.active AND (p_only IS NULL OR w.id=p_only)
    AND (p_type='webhook.test' OR p_type=ANY(w.events) OR (p_type='lead.connected' AND ('lead.connected.'||lower(coalesce(p_channel,'')))=ANY(w.events)))
    AND (p_type='webhook.test' OR w.list_ids IS NULL OR p_list=ANY(w.list_ids));
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'integration event dropped: %',SQLSTATE;RETURN NULL;END;
 RETURN v;
END $$;
-- Cheap guard first: imports into workspaces without webhooks skip building the payload.
CREATE OR REPLACE FUNCTION app.integration_lead_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.webhook_destination WHERE workspace_id=NEW.workspace_id AND active) THEN RETURN NULL;END IF;
 IF TG_OP='INSERT' THEN
  -- Only a real merge undo restoring this exact snapshot is exempt (same check as the billing guard).
  IF NOT EXISTS(SELECT 1 FROM app.merge_source s JOIN app.merge_record m ON m.workspace_id=s.workspace_id AND m.id=s.merge_id WHERE s.workspace_id=NEW.workspace_id AND s.lead_id=NEW.id AND m.state='merged' AND m.id=nullif(current_setting('app.lifecycle_undo',true),'')) THEN
   PERFORM app.emit_integration_event(NEW.workspace_id,'lead.created','lead',NEW.id,NEW.list_id,NULL,app.webhook_lead_data(NEW.workspace_id,NEW.payload,NEW.list_id));END IF;
 ELSIF NEW.payload->>'qualification'='qualified' AND coalesce(OLD.payload->>'qualification','')<>'qualified' THEN
  PERFORM app.emit_integration_event(NEW.workspace_id,'lead.qualified','lead',NEW.id,NEW.list_id,NULL,app.webhook_lead_data(NEW.workspace_id,NEW.payload,NEW.list_id));
 END IF;
 RETURN NULL;
END $$;
-- WhatsApp replies are emitted on receipt; email replies only after classification (below), so auto-replies and bounces never count.
CREATE OR REPLACE FUNCTION app.integration_reply_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.lead;
BEGIN
 IF NEW.direction<>'inbound' OR NEW.channel<>'WHATSAPP' THEN RETURN NULL;END IF;
 SELECT ld.* INTO l FROM app.channel_conversation cc JOIN app.lead ld ON ld.workspace_id=cc.workspace_id AND ld.id=cc.lead_id WHERE cc.workspace_id=NEW.workspace_id AND cc.id=NEW.conversation_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM app.emit_integration_event(NEW.workspace_id,'lead.connected','lead',l.id,l.list_id,NEW.channel,
  app.webhook_lead_data(NEW.workspace_id,l.payload,l.list_id)||jsonb_build_object('message',jsonb_build_object('id',NEW.id,'channel',NEW.channel,'receivedAt',coalesce(NEW.occurred_at,NEW.created_at))));
 RETURN NULL;
END $$;
-- Same gate as apply_mail_inbound: a human, complete message in a thread the app started with this identity.
CREATE FUNCTION app.integration_mail_reply_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m app.channel_message;l app.lead;
BEGIN
 IF NEW.classification_evidence->'assessment'->>'kind' IS DISTINCT FROM 'human' OR NEW.truncated THEN RETURN NULL;END IF;
 SELECT * INTO m FROM app.channel_message WHERE workspace_id=NEW.workspace_id AND id=NEW.message_id;
 IF NOT FOUND OR m.direction<>'inbound' THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM app.email_message em JOIN app.message_outbox o ON o.workspace_id=em.workspace_id AND o.message_id=em.message_id
  WHERE em.workspace_id=NEW.workspace_id AND em.thread_id=NEW.thread_id AND em.origin='app' AND o.identity_id=m.identity_id) THEN RETURN NULL;END IF;
 SELECT ld.* INTO l FROM app.channel_conversation cc JOIN app.lead ld ON ld.workspace_id=cc.workspace_id AND ld.id=cc.lead_id WHERE cc.workspace_id=m.workspace_id AND cc.id=m.conversation_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM app.emit_integration_event(NEW.workspace_id,'lead.connected','lead',l.id,l.list_id,'EMAIL',
  app.webhook_lead_data(NEW.workspace_id,l.payload,l.list_id)||jsonb_build_object('message',jsonb_build_object('id',m.id,'channel','EMAIL','receivedAt',coalesce(m.occurred_at,m.created_at))));
 RETURN NULL;
END $$;
CREATE TRIGGER integration_mail_reply AFTER INSERT ON app.email_message FOR EACH ROW EXECUTE FUNCTION app.integration_mail_reply_trigger();
-- A deleted lead's undelivered events are cancelled and their copy of the lead is erased.
CREATE FUNCTION app.integration_lead_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.integration_delivery d SET state='cancelled',lease_token=NULL FROM app.integration_event e
  WHERE e.workspace_id=OLD.workspace_id AND e.entity_kind='lead' AND e.entity_id=OLD.id AND d.workspace_id=e.workspace_id AND d.event_id=e.id AND d.state IN('pending','held','failed');
 UPDATE app.integration_event SET data=jsonb_build_object('deleted',true) WHERE workspace_id=OLD.workspace_id AND entity_kind='lead' AND entity_id=OLD.id;
 RETURN NULL;
END $$;
CREATE TRIGGER integration_lead_delete AFTER DELETE ON app.lead FOR EACH ROW EXECUTE FUNCTION app.integration_lead_delete();
-- Tests are refused while the destination waits for a person, instead of silently queueing as held.
CREATE OR REPLACE FUNCTION app.webhook_test(p_id text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);w app.webhook_destination;v text;
BEGIN
 PERFORM app.webhook_actor();
 SELECT * INTO w FROM app.webhook_destination WHERE workspace_id=ws AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'WEBHOOK_NOT_FOUND';END IF;
 IF w.attention IS NOT NULL THEN RAISE EXCEPTION 'WEBHOOK_ATTENTION';END IF;
 v:=app.emit_integration_event(ws,'webhook.test','webhook',p_id,NULL,NULL,jsonb_build_object('message','Teste de entrega do Prometeus Cadence.'),p_id);
 IF v IS NULL THEN RAISE EXCEPTION 'WEBHOOK_INACTIVE';END IF;RETURN v;
END $$;
-- One delivery per call, so each lease starts when its attempt starts. A destination already tried this tick is skipped, so one slow
-- receiver costs other tenants at most one attempt per tick. Paused destinations and those waiting for a person are never sent to.
CREATE OR REPLACE FUNCTION app.claim_integration_deliveries(p_limit integer,p_token text) RETURNS TABLE(workspace_id text,id text,attempts integer,destination_id text,url text,secret jsonb,secret_revision integer,event jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INTEGRATION_LIMIT';END IF;
 UPDATE app.integration_delivery SET state='pending',lease_token=NULL,last_error='Resultado incerto: a tentativa não terminou.' WHERE state='delivering' AND lease_until<clock_timestamp();
 RETURN QUERY WITH due AS(
  SELECT d.workspace_id,d.id FROM app.integration_delivery d JOIN app.webhook_destination w ON w.workspace_id=d.workspace_id AND w.id=d.destination_id
  WHERE d.state='pending' AND d.next_at<=clock_timestamp() AND w.active AND w.attention IS NULL
   AND NOT (d.workspace_id||':'||d.destination_id)=ANY(coalesce(string_to_array(nullif(current_setting('app.integration_seen',true),''),','),'{}'))
  ORDER BY d.next_at LIMIT 1 FOR UPDATE OF d SKIP LOCKED),
 up AS(UPDATE app.integration_delivery d SET state='delivering',attempts=d.attempts+1,lease_token=p_token,lease_until=clock_timestamp()+interval '30 seconds' FROM due WHERE d.workspace_id=due.workspace_id AND d.id=due.id RETURNING d.*)
 SELECT up.workspace_id,up.id,up.attempts,w.id,w.url,w.secret,w.secret_revision,
  jsonb_build_object('id',e.id,'type',e.type,'occurredAt',e.occurred_at,'entity',jsonb_build_object('kind',e.entity_kind,'id',e.entity_id),'data',e.data)
 FROM up JOIN app.webhook_destination w ON w.workspace_id=up.workspace_id AND w.id=up.destination_id JOIN app.integration_event e ON e.workspace_id=up.workspace_id AND e.id=up.event_id;
END $$;
CREATE OR REPLACE FUNCTION app.finish_integration_delivery(p_ws text,p_id text,p_token text,p_state text,p_status integer,p_error text,p_next timestamptz,p_attention text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d app.integration_delivery;w app.webhook_destination;
BEGIN
 SELECT * INTO d FROM app.integration_delivery WHERE workspace_id=p_ws AND id=p_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'delivering' OR d.lease_token IS DISTINCT FROM p_token THEN RETURN false;END IF;
 IF p_state NOT IN('delivered','pending','failed','held') THEN RAISE EXCEPTION 'INTEGRATION_INVALID';END IF;
 SELECT * INTO w FROM app.webhook_destination WHERE workspace_id=p_ws AND id=d.destination_id FOR UPDATE;
 -- Paused while the attempt was in flight: a retry would send to a paused destination, so the delivery is cancelled.
 IF NOT w.active AND p_state='pending' THEN p_state:='cancelled';END IF;
 UPDATE app.integration_delivery SET state=p_state,last_status=p_status,last_error=left(p_error,300),next_at=coalesce(p_next,next_at),lease_token=NULL,lease_until=NULL,
  delivered_at=CASE WHEN p_state='delivered' THEN clock_timestamp() END WHERE workspace_id=p_ws AND id=p_id;
 IF p_state='delivered' THEN UPDATE app.webhook_destination SET consecutive_failures=0,last_success_at=clock_timestamp() WHERE workspace_id=p_ws AND id=d.destination_id;
 ELSIF p_state<>'cancelled' THEN
  -- Every failed attempt counts, retryable ones included, so a receiver failing for hours shows its alert.
  UPDATE app.webhook_destination SET consecutive_failures=consecutive_failures+1,last_failure_at=clock_timestamp(),attention=coalesce(p_attention,attention) WHERE workspace_id=p_ws AND id=d.destination_id;
  IF p_attention IS NOT NULL THEN UPDATE app.integration_delivery SET state='held' WHERE workspace_id=p_ws AND destination_id=d.destination_id AND state='pending';END IF;
 END IF;
 RETURN true;
END $$;
-- Retention: event copies of leads live 30 days; deliveries go with them.
CREATE FUNCTION app.purge_integration_events(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'INTEGRATION_LIMIT';END IF;
 WITH old AS(SELECT workspace_id,id FROM app.integration_event WHERE occurred_at<clock_timestamp()-interval '30 days' ORDER BY occurred_at LIMIT p_limit)
 DELETE FROM app.integration_event e USING old WHERE e.workspace_id=old.workspace_id AND e.id=old.id;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
REVOKE ALL ON FUNCTION app.integration_mail_reply_trigger(),app.integration_lead_delete(),app.purge_integration_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_integration_events(integer) TO cadence_worker;
