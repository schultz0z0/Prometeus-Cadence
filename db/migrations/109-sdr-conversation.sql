-- 07B.2: supervised SDR conversations. One turn per inbound, serial per conversation, draft waits for a person;
-- the reviewed WhatsApp path is the only way out. Claim and finish are for the worker, the rest for members.
CREATE TABLE app.sdr_thread_state(
 workspace_id text NOT NULL,conversation_id text NOT NULL,owner text NOT NULL DEFAULT 'agent' CHECK(owner IN('agent','human')),revision bigint NOT NULL DEFAULT 1,
 changed_by text,changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,conversation_id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES app.channel_conversation(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE app.sdr_turn(
 workspace_id text NOT NULL,id text NOT NULL DEFAULT gen_random_uuid()::text,conversation_id text NOT NULL,inbound_message_id text NOT NULL,agent_id text NOT NULL,agent_revision bigint NOT NULL,
 state text NOT NULL CHECK(state IN('queued','claimed','pending-approval','approving','sent','handed-off','abstained','blocked','rejected','superseded','uncertain')),
 lease_token text,lease_until timestamptz,reserved boolean NOT NULL DEFAULT false,text text CHECK(length(text)<=4096),fields jsonb NOT NULL DEFAULT '[]',reason text,usage jsonb,
 approve_request text,message_id text,decided_by text,decided_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,conversation_id,inbound_message_id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES app.channel_conversation(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX sdr_turn_open ON app.sdr_turn(workspace_id,state,created_at) WHERE state IN('queued','claimed','pending-approval','uncertain');
CREATE INDEX sdr_turn_conversation ON app.sdr_turn(workspace_id,conversation_id,created_at DESC);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['sdr_thread_state','sdr_turn'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
 EXECUTE format('CREATE POLICY ws_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
END LOOP;END $$;
GRANT SELECT ON app.sdr_thread_state,app.sdr_turn TO cadence_app;

CREATE FUNCTION app.sdr_within_hours(h jsonb,at timestamptz) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT (h->'weekdays')@>to_jsonb(extract(dow FROM at AT TIME ZONE (h->>'timezone'))::int)
  AND ((h->>'allDay')::boolean OR to_char(at AT TIME ZONE (h->>'timezone'),'HH24:MI') BETWEEN h->>'start' AND h->>'end' AND to_char(at AT TIME ZONE (h->>'timezone'),'HH24:MI')<>h->>'end')
$$;
-- The billing functions read the session's workspace and member; the worker has neither.
CREATE FUNCTION app.sdr_act_as(p_ws text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT set_config('app.workspace_id',p_ws,true),set_config('app.user_id',(SELECT m."userId" FROM auth.member m WHERE m."organizationId"=p_ws ORDER BY m.role='owner' DESC,m."userId" LIMIT 1),true)
$$;
CREATE FUNCTION app.sdr_release_turn(t app.sdr_turn) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF t.reserved THEN PERFORM app.billing_release('sdr-turn:'||t.id);UPDATE app.sdr_turn SET reserved=false WHERE workspace_id=t.workspace_id AND id=t.id;END IF;
END $$;
-- A turn still in progress loses to a newer inbound or a person; one being approved is already on its way out.
CREATE FUNCTION app.sdr_supersede_open(p_ws text,p_conversation text,p_except text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.sdr_turn;
BEGIN
 FOR t IN SELECT * FROM app.sdr_turn WHERE workspace_id=p_ws AND conversation_id=p_conversation AND state IN('queued','claimed','pending-approval','uncertain') AND id IS DISTINCT FROM p_except FOR UPDATE LOOP
  PERFORM app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='superseded',decided_at=clock_timestamp() WHERE workspace_id=p_ws AND id=t.id;
 END LOOP;
END $$;
CREATE FUNCTION app.sdr_turn_payload(t app.sdr_turn) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('workspaceId',t.workspace_id,'turnId',t.id,'config',r.config,
  'context',(SELECT v.payload FROM app.context_version v WHERE v.workspace_id=t.workspace_id AND v.version=r.context_version),
  'knowledge',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',k.kind,'title',k.title,'body',k.body)) FROM app.sdr_knowledge k WHERE k.workspace_id=t.workspace_id AND k.state='approved' AND k.id IN(SELECT s->>'id' FROM jsonb_array_elements(r.knowledge) s)),'[]'),
  'incoming',(SELECT m.text FROM app.channel_message m WHERE m.workspace_id=t.workspace_id AND m.id=t.inbound_message_id),
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('direction',h.direction,'text',h.text) ORDER BY h.message_order) FROM (SELECT m.direction,m.text,m.message_order FROM app.channel_message m
    WHERE m.workspace_id=t.workspace_id AND m.conversation_id=t.conversation_id AND m.id<>t.inbound_message_id AND m.text IS NOT NULL AND m.text_purged_at IS NULL ORDER BY m.message_order DESC LIMIT 20) h),'[]'))
 FROM app.sdr_agent_revision r WHERE r.workspace_id=t.workspace_id AND r.agent_id=t.agent_id AND r.revision=t.agent_revision
$$;
CREATE FUNCTION app.sdr_claim_turn(p_token text,p_now timestamptz,p_workspace text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.sdr_turn;x record;a record;
BEGIN
 -- A lost worker may have reached the provider: never retried on its own.
 UPDATE app.sdr_turn SET state='uncertain',reason='WORKER_LOST' WHERE state='claimed' AND lease_until<=p_now AND (p_workspace IS NULL OR workspace_id=p_workspace);
 SELECT * INTO t FROM app.sdr_turn WHERE state='queued' AND (p_workspace IS NULL OR workspace_id=p_workspace) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF FOUND THEN
  UPDATE app.sdr_turn SET state='claimed',lease_token=p_token,lease_until=p_now+interval '5 minutes' WHERE workspace_id=t.workspace_id AND id=t.id RETURNING * INTO t;
  RETURN app.sdr_turn_payload(t);
 END IF;
 FOR x IN SELECT b.workspace_id,b.connection_id,cc.id conversation_id,cc.identity_id,m.id inbound_id FROM app.sdr_channel_binding b
   JOIN app.channel_conversation cc ON cc.workspace_id=b.workspace_id AND cc.connection_id=b.connection_id AND cc.channel='WHATSAPP'
   CROSS JOIN LATERAL (SELECT i.id,i.created_at,i.text FROM app.channel_message i WHERE i.workspace_id=cc.workspace_id AND i.conversation_id=cc.id AND i.direction='inbound' ORDER BY i.message_order DESC LIMIT 1) m
  WHERE (p_workspace IS NULL OR b.workspace_id=p_workspace) AND m.text IS NOT NULL AND m.created_at>=b.created_at
   AND NOT EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=cc.workspace_id AND u.conversation_id=cc.id AND (u.inbound_message_id=m.id OR u.state IN('claimed','approving')))
   AND NOT EXISTS(SELECT 1 FROM app.sdr_thread_state s WHERE s.workspace_id=cc.workspace_id AND s.conversation_id=cc.id AND s.owner='human')
   AND NOT EXISTS(SELECT 1 FROM app.contact_suppression c WHERE c.workspace_id=cc.workspace_id AND c.identity_id=cc.identity_id AND c.scope IN('all','service'))
  ORDER BY m.created_at LIMIT 50
 LOOP
  CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('sdr-conversation:'||x.conversation_id,0));
  SELECT * INTO a FROM app.sdr_agent_for_connection(x.connection_id);
  CONTINUE WHEN NOT FOUND OR NOT app.sdr_within_hours(a.config->'hours',p_now);
  INSERT INTO app.sdr_turn(workspace_id,conversation_id,inbound_message_id,agent_id,agent_revision,state,lease_token,lease_until)
   VALUES(x.workspace_id,x.conversation_id,x.inbound_id,a.agent_id,a.revision,'claimed',p_token,p_now+interval '5 minutes') ON CONFLICT DO NOTHING RETURNING * INTO t;
  CONTINUE WHEN t.id IS NULL;
  PERFORM app.sdr_act_as(x.workspace_id),app.sdr_supersede_open(x.workspace_id,x.conversation_id,t.id);
  IF (SELECT count(*) FROM app.sdr_turn u WHERE u.workspace_id=x.workspace_id AND u.agent_id=a.agent_id AND u.state IN('pending-approval','approving','sent') AND u.created_at>p_now-interval '1 day')>=(a.config->>'maxRepliesPerDay')::int THEN
   UPDATE app.sdr_turn SET state='blocked',reason='DAILY_LIMIT',decided_at=clock_timestamp() WHERE workspace_id=x.workspace_id AND id=t.id;CONTINUE;
  END IF;
  BEGIN
   PERFORM app.billing_reserve('sdr-turn:'||t.id,'sdr',1);
   UPDATE app.sdr_turn SET reserved=true WHERE workspace_id=x.workspace_id AND id=t.id RETURNING * INTO t;
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT IN('BILLING_QUOTA','BILLING_REQUIRED') THEN RAISE;END IF;
   UPDATE app.sdr_turn SET state='blocked',reason='SDR_QUOTA',decided_at=clock_timestamp() WHERE workspace_id=x.workspace_id AND id=t.id;CONTINUE;
  END;
  RETURN app.sdr_turn_payload(t);
 END LOOP;
 RETURN NULL;
END $$;
-- Everything is re-checked under the lock: a person, a newer inbound, an opt-out or an agent out of service drop the answer; the receipt stays.
CREATE FUNCTION app.sdr_finish_turn(p_ws text,p_turn text,p_token text,p_decision text,p_text text,p_fields jsonb,p_usage jsonb,p_reason text,p_now timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.sdr_turn;cc app.channel_conversation;member text;label text;href text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('sdr-conversation:'||(SELECT conversation_id FROM app.sdr_turn WHERE workspace_id=p_ws AND id=p_turn),0));
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=p_ws AND id=p_turn AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN 'lost';END IF;
 UPDATE app.sdr_turn SET usage=coalesce(p_usage,usage) WHERE workspace_id=p_ws AND id=p_turn;
 IF t.state<>'claimed' THEN RETURN t.state;END IF;
 PERFORM app.sdr_act_as(p_ws);
 SELECT * INTO cc FROM app.channel_conversation WHERE workspace_id=p_ws AND id=t.conversation_id;
 IF p_decision IS NULL THEN
  IF p_reason='AI_UNAVAILABLE' THEN PERFORM app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='blocked',reason=p_reason,decided_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_turn;RETURN 'blocked';END IF;
  UPDATE app.sdr_turn SET state='uncertain',reason=p_reason WHERE workspace_id=p_ws AND id=p_turn;RETURN 'uncertain';
 END IF;
 IF EXISTS(SELECT 1 FROM app.sdr_thread_state s WHERE s.workspace_id=p_ws AND s.conversation_id=t.conversation_id AND s.owner='human')
  OR EXISTS(SELECT 1 FROM app.contact_suppression c WHERE c.workspace_id=p_ws AND c.identity_id=cc.identity_id AND c.scope IN('all','service'))
  OR t.inbound_message_id<>(SELECT i.id FROM app.channel_message i WHERE i.workspace_id=p_ws AND i.conversation_id=t.conversation_id AND i.direction='inbound' ORDER BY i.message_order DESC LIMIT 1)
  OR NOT EXISTS(SELECT 1 FROM app.sdr_agent_for_connection(cc.connection_id) a WHERE a.agent_id=t.agent_id AND a.revision=t.agent_revision)
 THEN
  PERFORM app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='superseded',decided_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_turn;RETURN 'superseded';
 END IF;
 SELECT r.config#>>'{handoff,memberId}' INTO member FROM app.sdr_agent_revision r WHERE r.workspace_id=p_ws AND r.agent_id=t.agent_id AND r.revision=t.agent_revision;
 href:='/messages/whatsapp?conversation='||t.conversation_id;
 IF p_decision='reply' THEN
  UPDATE app.sdr_turn SET state='pending-approval',text=p_text,fields=coalesce(p_fields,'[]') WHERE workspace_id=p_ws AND id=p_turn;
  PERFORM app.notification_add(p_ws,member,'sdr-approval:'||p_turn,'approval','O Agente SDR preparou uma resposta para você revisar',href,p_now);
  RETURN 'pending-approval';
 END IF;
 PERFORM app.sdr_release_turn(t);
 IF p_decision='handoff' THEN
  INSERT INTO app.sdr_thread_state(workspace_id,conversation_id,owner) VALUES(p_ws,t.conversation_id,'human')
   ON CONFLICT(workspace_id,conversation_id) DO UPDATE SET owner='human',revision=app.sdr_thread_state.revision+1,changed_by=NULL,changed_at=clock_timestamp();
  UPDATE app.sdr_turn SET state='handed-off',text=p_text,fields=coalesce(p_fields,'[]'),decided_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_turn;
  PERFORM app.notification_add(p_ws,member,'sdr-handoff:'||p_turn,'handoff','O Agente SDR passou uma conversa para você',href,p_now);
  RETURN 'handed-off';
 END IF;
 UPDATE app.sdr_turn SET state='abstained',reason=coalesce(p_reason,'ABSTAINED'),fields=coalesce(p_fields,'[]'),decided_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_turn;
 RETURN 'abstained';
END $$;
-- Members. The caller's workspace comes from the session; RLS-free lookups always filter by it.
CREATE FUNCTION app.sdr_set_owner(p_conversation text,p_owner text,p_expected bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);cur app.sdr_thread_state;
BEGIN
 PERFORM app.sdr_role(false);
 IF NOT EXISTS(SELECT 1 FROM app.channel_conversation WHERE workspace_id=ws AND id=p_conversation) THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sdr-conversation:'||p_conversation,0));
 SELECT * INTO cur FROM app.sdr_thread_state WHERE workspace_id=ws AND conversation_id=p_conversation;
 -- Asking for the state it already has is a harmless repeat (double click).
 IF coalesce(cur.owner,'agent')=p_owner AND (p_owner='human' OR cur.owner IS NULL) THEN RETURN coalesce(cur.revision,0);END IF;
 IF p_expected IS NOT NULL AND coalesce(cur.revision,0)<>p_expected AND coalesce(cur.owner,'agent')<>p_owner THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 IF p_owner='human' THEN PERFORM app.sdr_supersede_open(ws,p_conversation,NULL);END IF;
 INSERT INTO app.sdr_thread_state(workspace_id,conversation_id,owner,changed_by) VALUES(ws,p_conversation,p_owner,uid)
  ON CONFLICT(workspace_id,conversation_id) DO UPDATE SET owner=p_owner,revision=app.sdr_thread_state.revision+1,changed_by=uid,changed_at=clock_timestamp() RETURNING * INTO cur;
 RETURN cur.revision;
END $$;
CREATE FUNCTION app.sdr_note_human_reply(p_conversation text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 -- Conversations no agent ever touched stay out of this table.
 IF EXISTS(SELECT 1 FROM app.sdr_turn WHERE workspace_id=ws AND conversation_id=p_conversation)
  OR EXISTS(SELECT 1 FROM app.sdr_channel_binding b JOIN app.channel_conversation cc ON cc.workspace_id=b.workspace_id AND cc.connection_id=b.connection_id WHERE cc.workspace_id=ws AND cc.id=p_conversation)
 THEN PERFORM app.sdr_set_owner(p_conversation,'human',NULL);END IF;
END $$;
CREATE FUNCTION app.sdr_retry_turn(p_turn text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 PERFORM app.sdr_role(false);
 UPDATE app.sdr_turn SET state='queued',lease_token=NULL,lease_until=NULL,reason=NULL WHERE workspace_id=ws AND id=p_turn AND state='uncertain';
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_STATE';END IF;
END $$;
CREATE FUNCTION app.sdr_reject_turn(p_turn text) RETURNS app.sdr_turn LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.sdr_turn;
BEGIN
 PERFORM app.sdr_role(false);
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn AND state='pending-approval' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 PERFORM app.sdr_release_turn(t);
 UPDATE app.sdr_turn SET state='rejected',decided_by=current_setting('app.user_id',true),decided_at=clock_timestamp() WHERE workspace_id=ws AND id=p_turn RETURNING * INTO t;
 RETURN t;
END $$;
-- Returns the state before the claim: 'sent' means this same request already finished.
CREATE FUNCTION app.sdr_claim_approval(p_turn text,p_request text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.sdr_turn;
BEGIN
 PERFORM app.sdr_role(false);
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 IF t.state IN('sent','approving') AND t.approve_request=p_request THEN RETURN t.state;END IF;
 IF t.state<>'pending-approval' THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 UPDATE app.sdr_turn SET state='approving',approve_request=p_request WHERE workspace_id=ws AND id=p_turn;
 RETURN 'pending-approval';
END $$;
CREATE FUNCTION app.sdr_release_approval(p_turn text,p_request text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE app.sdr_turn SET state='pending-approval',approve_request=NULL WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_turn AND state='approving' AND approve_request=p_request AND app.current_role() IS NOT NULL
$$;
CREATE FUNCTION app.sdr_finish_approval(p_turn text,p_request text,p_message text,p_text text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.sdr_turn;
BEGIN
 PERFORM app.sdr_role(false);
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn AND state='approving' AND approve_request=p_request FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF t.reserved THEN PERFORM app.billing_consume('sdr-turn:'||t.id,'sdr',1,'sdr-turn:'||t.id),app.billing_release('sdr-turn:'||t.id);END IF;
 UPDATE app.sdr_turn SET state='sent',reserved=false,text=p_text,message_id=p_message,decided_by=current_setting('app.user_id',true),decided_at=clock_timestamp() WHERE workspace_id=ws AND id=p_turn;
END $$;
REVOKE ALL ON FUNCTION app.sdr_within_hours(jsonb,timestamptz),app.sdr_act_as(text),app.sdr_release_turn(app.sdr_turn),app.sdr_supersede_open(text,text,text),app.sdr_turn_payload(app.sdr_turn),
 app.sdr_claim_turn(text,timestamptz,text),app.sdr_finish_turn(text,text,text,text,text,jsonb,jsonb,text,timestamptz),app.sdr_set_owner(text,text,bigint),app.sdr_note_human_reply(text),
 app.sdr_retry_turn(text),app.sdr_reject_turn(text),app.sdr_claim_approval(text,text),app.sdr_release_approval(text,text),app.sdr_finish_approval(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sdr_within_hours(jsonb,timestamptz),app.sdr_set_owner(text,text,bigint),app.sdr_note_human_reply(text),app.sdr_retry_turn(text),app.sdr_reject_turn(text),
 app.sdr_claim_approval(text,text),app.sdr_release_approval(text,text),app.sdr_finish_approval(text,text,text,text) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.sdr_claim_turn(text,timestamptz,text),app.sdr_finish_turn(text,text,text,text,text,jsonb,jsonb,text,timestamptz) TO cadence_worker;
