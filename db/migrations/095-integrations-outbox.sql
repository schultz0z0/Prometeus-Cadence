-- 07C.1a: outbound webhooks. Events are written by triggers inside the domain transaction (an aborted commit leaves none);
-- deliveries are fanned out at the same moment to the destinations active then. Delivery is at-least-once.
CREATE TABLE app.webhook_destination(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL DEFAULT gen_random_uuid()::text,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),url text NOT NULL CHECK(length(url) BETWEEN 8 AND 2000 AND url ~ '^https?://'),
 events text[] NOT NULL CHECK(cardinality(events) BETWEEN 1 AND 5 AND events <@ ARRAY['lead.created','lead.qualified','lead.connected','lead.connected.email','lead.connected.whatsapp']),
 list_ids text[] CHECK(list_ids IS NULL OR cardinality(list_ids) BETWEEN 1 AND 50),
 active boolean NOT NULL DEFAULT true,attention text CHECK(attention IN('unauthorized','gone','address','redirect')),
 secret jsonb,secret_revision integer NOT NULL DEFAULT 0,revision bigint NOT NULL DEFAULT 1,
 consecutive_failures integer NOT NULL DEFAULT 0,last_success_at timestamptz,last_failure_at timestamptz,
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE app.integration_event(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL DEFAULT gen_random_uuid()::text,
 type text NOT NULL CHECK(type IN('lead.created','lead.qualified','lead.connected','webhook.test')),
 entity_kind text NOT NULL,entity_id text NOT NULL,list_id text,channel text,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 data jsonb NOT NULL CHECK(length(data::text)<=200000),PRIMARY KEY(workspace_id,id)
);
CREATE TABLE app.integration_delivery(
 workspace_id text NOT NULL,id text NOT NULL DEFAULT gen_random_uuid()::text,destination_id text NOT NULL,event_id text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','delivering','delivered','failed','held','cancelled')),
 attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT clock_timestamp(),lease_token text,lease_until timestamptz,
 last_status integer,last_error text CHECK(length(last_error)<=300),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),delivered_at timestamptz,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,destination_id,event_id),
 FOREIGN KEY(workspace_id,destination_id) REFERENCES app.webhook_destination(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,event_id) REFERENCES app.integration_event(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX integration_delivery_due ON app.integration_delivery(next_at) WHERE state='pending';
CREATE INDEX integration_delivery_history ON app.integration_delivery(workspace_id,destination_id,created_at DESC);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['webhook_destination','integration_event','integration_delivery'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
 EXECUTE format('CREATE POLICY tenant_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IN(''owner'',''admin''))',t);
END LOOP;END $$;
GRANT SELECT ON app.webhook_destination,app.integration_event,app.integration_delivery TO cadence_app;

-- Owner/admin gate for every destination mutation, under the workspace lock.
CREATE FUNCTION app.webhook_actor() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r text:=app.lock_membership();
BEGIN
 IF r IS NULL OR r NOT IN('owner','admin') THEN RAISE EXCEPTION 'WEBHOOK_ACCESS';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(current_setting('app.workspace_id',true)||':webhooks',0));RETURN r;
END $$;
CREATE FUNCTION app.save_webhook(p_id text,p_new boolean,p_expected bigint,p_name text,p_url text,p_events text[],p_lists text[],p_secret jsonb) RETURNS app.webhook_destination
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.webhook_destination;
BEGIN
 PERFORM app.webhook_actor();
 IF p_new THEN
  IF p_expected<>0 THEN RAISE EXCEPTION 'WEBHOOK_CONFLICT';END IF;
  IF (SELECT count(*) FROM app.webhook_destination WHERE workspace_id=ws)>=10 THEN RAISE EXCEPTION 'WEBHOOK_LIMIT';END IF;
  INSERT INTO app.webhook_destination(workspace_id,id,name,url,events,list_ids,secret,secret_revision,created_by) VALUES(ws,p_id,p_name,p_url,p_events,p_lists,p_secret,CASE WHEN p_secret IS NULL THEN 0 ELSE 1 END,current_setting('app.user_id',true)) RETURNING * INTO r;
 ELSE
  SELECT * INTO r FROM app.webhook_destination WHERE workspace_id=ws AND id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEBHOOK_NOT_FOUND';END IF;
  IF r.revision<>p_expected THEN RAISE EXCEPTION 'WEBHOOK_CONFLICT';END IF;
  -- Editing is how a person resolves an attention state; the URL or credentials may have been fixed.
  UPDATE app.webhook_destination SET name=p_name,url=p_url,events=p_events,list_ids=p_lists,attention=NULL,consecutive_failures=0,
   secret=coalesce(p_secret,secret),secret_revision=secret_revision+CASE WHEN p_secret IS NULL THEN 0 ELSE 1 END,revision=revision+1,updated_at=clock_timestamp()
   WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
  UPDATE app.integration_delivery SET state='pending',next_at=clock_timestamp() WHERE workspace_id=ws AND destination_id=p_id AND state='held';
 END IF;
 RETURN r;
END $$;
CREATE FUNCTION app.webhook_action(p_id text,p_expected bigint,p_action text,p_secret jsonb) RETURNS app.webhook_destination
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.webhook_destination;
BEGIN
 PERFORM app.webhook_actor();
 SELECT * INTO r FROM app.webhook_destination WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'WEBHOOK_NOT_FOUND';END IF;
 IF r.revision<>p_expected THEN RAISE EXCEPTION 'WEBHOOK_CONFLICT';END IF;
 IF p_action='pause' THEN
  UPDATE app.webhook_destination SET active=false,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
  UPDATE app.integration_delivery SET state='cancelled',lease_token=NULL WHERE workspace_id=ws AND destination_id=p_id AND state IN('pending','held');
 ELSIF p_action='activate' THEN
  UPDATE app.webhook_destination SET active=true,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
 ELSIF p_action='secret' THEN
  IF p_secret IS NULL THEN RAISE EXCEPTION 'WEBHOOK_INVALID';END IF;
  UPDATE app.webhook_destination SET secret=p_secret,secret_revision=secret_revision+1,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
 ELSIF p_action='retry' THEN
  -- Failed or held deliveries of the last 24 h go back to the queue once; older ones stay failed.
  UPDATE app.webhook_destination SET attention=NULL,consecutive_failures=0,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id RETURNING * INTO r;
  UPDATE app.integration_delivery d SET state='pending',next_at=clock_timestamp(),attempts=0,last_error=NULL FROM app.integration_event e
   WHERE d.workspace_id=ws AND d.destination_id=p_id AND d.state IN('failed','held') AND e.workspace_id=d.workspace_id AND e.id=d.event_id AND e.occurred_at>clock_timestamp()-interval '24 hours';
 ELSIF p_action='delete' THEN
  DELETE FROM app.webhook_destination WHERE workspace_id=ws AND id=p_id;
 ELSE RAISE EXCEPTION 'WEBHOOK_INVALID';END IF;
 RETURN r;
END $$;
-- Fan-out at emission time: only destinations active now, subscribed to the type (or the reply channel) and to the list.
CREATE FUNCTION app.emit_integration_event(p_ws text,p_type text,p_kind text,p_entity text,p_list text,p_channel text,p_data jsonb,p_only text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.webhook_destination d WHERE d.workspace_id=p_ws AND d.active AND (p_only IS NULL OR d.id=p_only)
  AND (p_type='webhook.test' OR p_type=ANY(d.events) OR (p_type='lead.connected' AND ('lead.connected.'||lower(coalesce(p_channel,'')))=ANY(d.events)))
  AND (p_type='webhook.test' OR d.list_ids IS NULL OR p_list=ANY(d.list_ids))) THEN RETURN NULL;END IF;
 INSERT INTO app.integration_event(workspace_id,type,entity_kind,entity_id,list_id,channel,data) VALUES(p_ws,p_type,p_kind,p_entity,p_list,p_channel,p_data) RETURNING id INTO v;
 INSERT INTO app.integration_delivery(workspace_id,destination_id,event_id,state)
  SELECT p_ws,d.id,v,CASE WHEN d.attention IS NULL THEN 'pending' ELSE 'held' END FROM app.webhook_destination d WHERE d.workspace_id=p_ws AND d.active AND (p_only IS NULL OR d.id=p_only)
   AND (p_type='webhook.test' OR p_type=ANY(d.events) OR (p_type='lead.connected' AND ('lead.connected.'||lower(coalesce(p_channel,'')))=ANY(d.events)))
   AND (p_type='webhook.test' OR d.list_ids IS NULL OR p_list=ANY(d.list_ids));
 RETURN v;
END $$;
CREATE FUNCTION app.webhook_lead_data(p_ws text,p_lead jsonb,p_list text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('lead',p_lead,'list',jsonb_build_object('id',p_list,'name',(SELECT name FROM app.list WHERE workspace_id=p_ws AND id=p_list)))
$$;
CREATE FUNCTION app.integration_lead_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  -- A merge undo restores a contact that already existed; it is not a new lead.
  IF nullif(current_setting('app.lifecycle_undo',true),'') IS NULL THEN
   PERFORM app.emit_integration_event(NEW.workspace_id,'lead.created','lead',NEW.id,NEW.list_id,NULL,app.webhook_lead_data(NEW.workspace_id,NEW.payload,NEW.list_id));END IF;
 ELSIF NEW.payload->>'qualification'='qualified' AND coalesce(OLD.payload->>'qualification','')<>'qualified' THEN
  PERFORM app.emit_integration_event(NEW.workspace_id,'lead.qualified','lead',NEW.id,NEW.list_id,NULL,app.webhook_lead_data(NEW.workspace_id,NEW.payload,NEW.list_id));
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER integration_lead AFTER INSERT OR UPDATE OF payload ON app.lead FOR EACH ROW EXECUTE FUNCTION app.integration_lead_trigger();
-- Replies carry the lead and where it answered, not the message text.
CREATE FUNCTION app.integration_reply_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l app.lead;
BEGIN
 IF NEW.direction<>'inbound' THEN RETURN NULL;END IF;
 SELECT ld.* INTO l FROM app.channel_conversation cc JOIN app.lead ld ON ld.workspace_id=cc.workspace_id AND ld.id=cc.lead_id WHERE cc.workspace_id=NEW.workspace_id AND cc.id=NEW.conversation_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM app.emit_integration_event(NEW.workspace_id,'lead.connected','lead',l.id,l.list_id,NEW.channel,
  app.webhook_lead_data(NEW.workspace_id,l.payload,l.list_id)||jsonb_build_object('message',jsonb_build_object('id',NEW.id,'channel',NEW.channel,'receivedAt',coalesce(NEW.occurred_at,NEW.created_at))));
 RETURN NULL;
END $$;
CREATE TRIGGER integration_reply AFTER INSERT ON app.channel_message FOR EACH ROW EXECUTE FUNCTION app.integration_reply_trigger();
CREATE FUNCTION app.webhook_test(p_id text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);v text;
BEGIN
 PERFORM app.webhook_actor();
 IF NOT EXISTS(SELECT 1 FROM app.webhook_destination WHERE workspace_id=ws AND id=p_id) THEN RAISE EXCEPTION 'WEBHOOK_NOT_FOUND';END IF;
 v:=app.emit_integration_event(ws,'webhook.test','webhook',p_id,NULL,NULL,jsonb_build_object('message','Teste de entrega do Prometeus Cadence.'),p_id);
 IF v IS NULL THEN RAISE EXCEPTION 'WEBHOOK_INACTIVE';END IF;RETURN v;
END $$;
-- Worker: lease due deliveries across workspaces. The secret leaves the database only encrypted; the worker decrypts in memory.
CREATE FUNCTION app.claim_integration_deliveries(p_limit integer,p_token text) RETURNS TABLE(workspace_id text,id text,attempts integer,destination_id text,url text,secret jsonb,secret_revision integer,event jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INTEGRATION_LIMIT';END IF;
 -- A lease that expired mid-attempt is an uncertain outcome; it is retried with the same idempotency key.
 UPDATE app.integration_delivery SET state='pending',lease_token=NULL,last_error='Resultado incerto: a tentativa não terminou.' WHERE state='delivering' AND lease_until<clock_timestamp();
 RETURN QUERY WITH due AS(
  SELECT d.workspace_id,d.id FROM app.integration_delivery d WHERE d.state='pending' AND d.next_at<=clock_timestamp() ORDER BY d.next_at LIMIT p_limit FOR UPDATE SKIP LOCKED),
 up AS(UPDATE app.integration_delivery d SET state='delivering',attempts=d.attempts+1,lease_token=p_token,lease_until=clock_timestamp()+interval '60 seconds' FROM due WHERE d.workspace_id=due.workspace_id AND d.id=due.id RETURNING d.*)
 SELECT up.workspace_id,up.id,up.attempts,w.id,w.url,w.secret,w.secret_revision,
  jsonb_build_object('id',e.id,'type',e.type,'occurredAt',e.occurred_at,'entity',jsonb_build_object('kind',e.entity_kind,'id',e.entity_id),'data',e.data)
 FROM up JOIN app.webhook_destination w ON w.workspace_id=up.workspace_id AND w.id=up.destination_id JOIN app.integration_event e ON e.workspace_id=up.workspace_id AND e.id=up.event_id;
END $$;
CREATE FUNCTION app.finish_integration_delivery(p_ws text,p_id text,p_token text,p_state text,p_status integer,p_error text,p_next timestamptz,p_attention text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d app.integration_delivery;
BEGIN
 SELECT * INTO d FROM app.integration_delivery WHERE workspace_id=p_ws AND id=p_id FOR UPDATE;
 -- A pause, deletion or re-lease since the claim wins; the late result is dropped.
 IF NOT FOUND OR d.state<>'delivering' OR d.lease_token IS DISTINCT FROM p_token THEN RETURN false;END IF;
 IF p_state NOT IN('delivered','pending','failed','held') THEN RAISE EXCEPTION 'INTEGRATION_INVALID';END IF;
 UPDATE app.integration_delivery SET state=p_state,last_status=p_status,last_error=left(p_error,300),next_at=coalesce(p_next,next_at),lease_token=NULL,lease_until=NULL,
  delivered_at=CASE WHEN p_state='delivered' THEN clock_timestamp() END WHERE workspace_id=p_ws AND id=p_id;
 IF p_state='delivered' THEN UPDATE app.webhook_destination SET consecutive_failures=0,last_success_at=clock_timestamp() WHERE workspace_id=p_ws AND id=d.destination_id;
 ELSIF p_state IN('failed','held') OR p_attention IS NOT NULL THEN
  UPDATE app.webhook_destination SET consecutive_failures=consecutive_failures+1,last_failure_at=clock_timestamp(),attention=coalesce(p_attention,attention) WHERE workspace_id=p_ws AND id=d.destination_id;
  -- Once a destination needs a person, its other queued deliveries wait instead of failing one by one.
  IF p_attention IS NOT NULL THEN UPDATE app.integration_delivery SET state='held' WHERE workspace_id=p_ws AND destination_id=d.destination_id AND state='pending';END IF;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.webhook_actor(),app.save_webhook(text,boolean,bigint,text,text,text[],text[],jsonb),app.webhook_action(text,bigint,text,jsonb),app.emit_integration_event(text,text,text,text,text,text,jsonb,text),app.webhook_lead_data(text,jsonb,text),app.integration_lead_trigger(),app.integration_reply_trigger(),app.webhook_test(text),app.claim_integration_deliveries(integer,text),app.finish_integration_delivery(text,text,text,text,integer,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.save_webhook(text,boolean,bigint,text,text,text[],text[],jsonb),app.webhook_action(text,bigint,text,jsonb),app.webhook_test(text) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.claim_integration_deliveries(integer,text),app.finish_integration_delivery(text,text,text,text,integer,text,timestamptz,text) TO cadence_worker;
