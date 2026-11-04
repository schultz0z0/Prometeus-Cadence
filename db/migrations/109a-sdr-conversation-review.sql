-- 07B.2 review. Approval and enqueue share one transaction (no 'approving' state, nothing to get stuck or double-send);
-- gates run before the candidate limit, so one tenant cannot starve the others; retry, queued turns and finish share
-- one eligibility check; retries are capped; old or opted-out open turns release their unit; pausing drops the
-- agent's open turns; retention reaches the draft; failed outbound stays out of the history.
DROP FUNCTION app.sdr_claim_approval(text,text);
DROP FUNCTION app.sdr_release_approval(text,text);
DROP FUNCTION app.sdr_finish_approval(text,text,text,text);
ALTER TABLE app.sdr_turn ADD COLUMN attempts integer NOT NULL DEFAULT 0,DROP CONSTRAINT sdr_turn_state_check,
 ADD CONSTRAINT sdr_turn_state_check CHECK(state IN('queued','claimed','pending-approval','sent','handed-off','abstained','blocked','rejected','superseded','uncertain'));
CREATE OR REPLACE FUNCTION app.sdr_supersede_open(p_ws text,p_conversation text,p_except text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.sdr_turn;
BEGIN
 FOR t IN SELECT * FROM app.sdr_turn WHERE workspace_id=p_ws AND conversation_id=p_conversation AND state IN('queued','claimed','pending-approval','uncertain') AND id IS DISTINCT FROM p_except FOR UPDATE LOOP
  PERFORM app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='superseded',decided_at=clock_timestamp() WHERE workspace_id=p_ws AND id=t.id;
 END LOOP;
END $$;
-- The conversation still wants this exact inbound answered: agent-owned, no opt-out, nothing newer, text still there.
CREATE FUNCTION app.sdr_thread_open(p_ws text,p_conversation text,p_inbound text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT 1 FROM app.sdr_thread_state s WHERE s.workspace_id=p_ws AND s.conversation_id=p_conversation AND s.owner='human')
  AND NOT EXISTS(SELECT 1 FROM app.channel_conversation cc JOIN app.contact_suppression c ON c.workspace_id=cc.workspace_id AND c.identity_id=cc.identity_id WHERE cc.workspace_id=p_ws AND cc.id=p_conversation AND c.scope IN('all','service'))
  AND EXISTS(SELECT 1 FROM (SELECT i.id,i.text,i.message_order FROM app.channel_message i WHERE i.workspace_id=p_ws AND i.conversation_id=p_conversation AND i.direction='inbound' ORDER BY i.message_order DESC LIMIT 1) m WHERE m.id=p_inbound AND m.text IS NOT NULL)
$$;
CREATE FUNCTION app.sdr_turn_eligible(t app.sdr_turn) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.sdr_thread_open(t.workspace_id,t.conversation_id,t.inbound_message_id)
  AND EXISTS(SELECT 1 FROM app.channel_conversation cc,app.sdr_agent_for_connection(cc.connection_id) a WHERE cc.workspace_id=t.workspace_id AND cc.id=t.conversation_id AND a.agent_id=t.agent_id AND a.revision=t.agent_revision)
$$;
-- The handoff member may have left: then owners and admins are told, so a conversation never goes silent.
CREATE FUNCTION app.sdr_notify(p_ws text,p_member text,p_key text,p_kind text,p_title text,p_href text,p_at timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u text;
BEGIN
 IF EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=p_ws AND m."userId"=p_member) THEN PERFORM app.notification_add(p_ws,p_member,p_key,p_kind,p_title,p_href,p_at);RETURN;END IF;
 FOR u IN SELECT m."userId" FROM auth.member m WHERE m."organizationId"=p_ws AND m.role IN('owner','admin') LOOP PERFORM app.notification_add(p_ws,u,p_key,p_kind,p_title,p_href,p_at);END LOOP;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_turn_payload(t app.sdr_turn) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('workspaceId',t.workspace_id,'turnId',t.id,'config',r.config,
  'context',(SELECT v.payload FROM app.context_version v WHERE v.workspace_id=t.workspace_id AND v.version=r.context_version),
  'knowledge',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',k.kind,'title',k.title,'body',k.body)) FROM app.sdr_knowledge k WHERE k.workspace_id=t.workspace_id AND k.state='approved' AND k.id IN(SELECT s->>'id' FROM jsonb_array_elements(r.knowledge) s)),'[]'),
  'incoming',(SELECT left(m.text,2000) FROM app.channel_message m WHERE m.workspace_id=t.workspace_id AND m.id=t.inbound_message_id),
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('direction',h.direction,'text',left(h.text,1000)) ORDER BY h.message_order) FROM (SELECT m.direction,m.text,m.message_order FROM app.channel_message m
    WHERE m.workspace_id=t.workspace_id AND m.conversation_id=t.conversation_id AND m.id<>t.inbound_message_id AND m.text IS NOT NULL AND m.text_purged_at IS NULL AND m.state NOT IN('failed','blocked','cancelled','uncertain') ORDER BY m.message_order DESC LIMIT 20) h),'[]'))
 FROM app.sdr_agent_revision r WHERE r.workspace_id=t.workspace_id AND r.agent_id=t.agent_id AND r.revision=t.agent_revision
$$;
CREATE OR REPLACE FUNCTION app.sdr_claim_turn(p_token text,p_now timestamptz,p_workspace text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.sdr_turn;x record;
BEGIN
 -- A lost worker may have reached the provider: never retried on its own.
 UPDATE app.sdr_turn SET state='uncertain',reason='WORKER_LOST' WHERE state='claimed' AND lease_until<=p_now AND (p_workspace IS NULL OR workspace_id=p_workspace);
 -- Open turns nobody will answer stop holding quota: old, or the contact opted out.
 FOR t IN SELECT u.* FROM app.sdr_turn u JOIN app.channel_conversation cc ON cc.workspace_id=u.workspace_id AND cc.id=u.conversation_id
   WHERE u.state IN('pending-approval','uncertain') AND (p_workspace IS NULL OR u.workspace_id=p_workspace)
    AND (u.created_at<p_now-interval '7 days' OR EXISTS(SELECT 1 FROM app.contact_suppression c WHERE c.workspace_id=cc.workspace_id AND c.identity_id=cc.identity_id AND c.scope IN('all','service')))
   ORDER BY u.created_at LIMIT 50 FOR UPDATE OF u SKIP LOCKED LOOP
  PERFORM app.sdr_act_as(t.workspace_id),app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='superseded',decided_at=clock_timestamp() WHERE workspace_id=t.workspace_id AND id=t.id;
 END LOOP;
 FOR t IN SELECT * FROM app.sdr_turn WHERE state='queued' AND (p_workspace IS NULL OR workspace_id=p_workspace) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20 LOOP
  IF app.sdr_turn_eligible(t) THEN
   UPDATE app.sdr_turn SET state='claimed',lease_token=p_token,lease_until=p_now+interval '5 minutes' WHERE workspace_id=t.workspace_id AND id=t.id RETURNING * INTO t;
   RETURN app.sdr_turn_payload(t);
  END IF;
  PERFORM app.sdr_act_as(t.workspace_id),app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='superseded',decided_at=clock_timestamp() WHERE workspace_id=t.workspace_id AND id=t.id;
 END LOOP;
 t:=NULL;
 -- Every gate before the limit, so conversations out of hours or out of service never fill the window.
 FOR x IN SELECT b.workspace_id,cc.id conversation_id,m.id inbound_id,a.agent_id,a.revision,a.config FROM app.sdr_channel_binding b
   JOIN app.channel_conversation cc ON cc.workspace_id=b.workspace_id AND cc.connection_id=b.connection_id AND cc.channel='WHATSAPP'
   CROSS JOIN LATERAL app.sdr_agent_for_connection(b.connection_id) a
   CROSS JOIN LATERAL (SELECT i.id,i.created_at,i.text,i.message_order FROM app.channel_message i WHERE i.workspace_id=cc.workspace_id AND i.conversation_id=cc.id AND i.direction='inbound' ORDER BY i.message_order DESC LIMIT 1) m
  WHERE (p_workspace IS NULL OR b.workspace_id=p_workspace) AND m.text IS NOT NULL AND m.created_at>=b.created_at AND app.sdr_within_hours(a.config->'hours',p_now)
   AND EXISTS(SELECT 1 FROM auth.member mm WHERE mm."organizationId"=b.workspace_id)
   AND NOT EXISTS(SELECT 1 FROM app.channel_message o WHERE o.workspace_id=cc.workspace_id AND o.conversation_id=cc.id AND o.direction='outbound' AND o.message_order>m.message_order AND o.state NOT IN('failed','blocked','cancelled'))
   AND NOT EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=cc.workspace_id AND u.conversation_id=cc.id AND (u.inbound_message_id=m.id OR u.state='claimed'))
   AND NOT EXISTS(SELECT 1 FROM app.sdr_thread_state s WHERE s.workspace_id=cc.workspace_id AND s.conversation_id=cc.id AND s.owner='human')
   AND NOT EXISTS(SELECT 1 FROM app.contact_suppression c WHERE c.workspace_id=cc.workspace_id AND c.identity_id=cc.identity_id AND c.scope IN('all','service'))
  ORDER BY m.created_at LIMIT 50
 LOOP
  CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('sdr-conversation:'||x.conversation_id,0));
  -- Re-read under the lock: a person or an opt-out may have just arrived.
  CONTINUE WHEN NOT app.sdr_thread_open(x.workspace_id,x.conversation_id,x.inbound_id) OR EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=x.workspace_id AND u.conversation_id=x.conversation_id AND u.state='claimed');
  INSERT INTO app.sdr_turn(workspace_id,conversation_id,inbound_message_id,agent_id,agent_revision,state,lease_token,lease_until)
   VALUES(x.workspace_id,x.conversation_id,x.inbound_id,x.agent_id,x.revision,'claimed',p_token,p_now+interval '5 minutes') ON CONFLICT DO NOTHING RETURNING * INTO t;
  CONTINUE WHEN t.id IS NULL;
  PERFORM app.sdr_act_as(x.workspace_id),app.sdr_supersede_open(x.workspace_id,x.conversation_id,t.id);
  IF (SELECT count(*) FROM app.sdr_turn u WHERE u.workspace_id=x.workspace_id AND u.agent_id=x.agent_id AND u.state IN('pending-approval','sent') AND u.created_at>p_now-interval '1 day')>=(x.config->>'maxRepliesPerDay')::int THEN
   UPDATE app.sdr_turn SET state='blocked',reason='DAILY_LIMIT',decided_at=clock_timestamp() WHERE workspace_id=x.workspace_id AND id=t.id;t:=NULL;CONTINUE;
  END IF;
  BEGIN
   PERFORM app.billing_reserve('sdr-turn:'||t.id,'sdr',1);
   UPDATE app.sdr_turn SET reserved=true WHERE workspace_id=x.workspace_id AND id=t.id RETURNING * INTO t;
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT IN('BILLING_QUOTA','BILLING_REQUIRED') THEN RAISE;END IF;
   UPDATE app.sdr_turn SET state='blocked',reason='SDR_QUOTA',decided_at=clock_timestamp() WHERE workspace_id=x.workspace_id AND id=t.id;t:=NULL;CONTINUE;
  END;
  RETURN app.sdr_turn_payload(t);
 END LOOP;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_finish_turn(p_ws text,p_turn text,p_token text,p_decision text,p_text text,p_fields jsonb,p_usage jsonb,p_reason text,p_now timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.sdr_turn;member text;href text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('sdr-conversation:'||(SELECT conversation_id FROM app.sdr_turn WHERE workspace_id=p_ws AND id=p_turn),0));
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=p_ws AND id=p_turn AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN 'lost';END IF;
 UPDATE app.sdr_turn SET usage=coalesce(p_usage,usage) WHERE workspace_id=p_ws AND id=p_turn;
 IF t.state<>'claimed' THEN RETURN t.state;END IF;
 PERFORM app.sdr_act_as(p_ws);
 IF NOT app.sdr_turn_eligible(t) THEN
  PERFORM app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='superseded',decided_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_turn;RETURN 'superseded';
 END IF;
 IF p_decision IS NULL THEN
  IF p_reason='AI_UNAVAILABLE' THEN PERFORM app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='blocked',reason=p_reason,decided_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_turn;RETURN 'blocked';END IF;
  UPDATE app.sdr_turn SET state='uncertain',reason=p_reason WHERE workspace_id=p_ws AND id=p_turn;RETURN 'uncertain';
 END IF;
 SELECT r.config#>>'{handoff,memberId}' INTO member FROM app.sdr_agent_revision r WHERE r.workspace_id=p_ws AND r.agent_id=t.agent_id AND r.revision=t.agent_revision;
 href:='/messages/whatsapp?conversation='||t.conversation_id;
 IF p_decision='reply' THEN
  UPDATE app.sdr_turn SET state='pending-approval',text=p_text,fields=coalesce(p_fields,'[]'),reason=NULL WHERE workspace_id=p_ws AND id=p_turn;
  PERFORM app.sdr_notify(p_ws,member,'sdr-approval:'||p_turn,'approval','O Agente SDR preparou uma resposta para você revisar',href,p_now);
  RETURN 'pending-approval';
 END IF;
 PERFORM app.sdr_release_turn(t);
 IF p_decision='handoff' THEN
  INSERT INTO app.sdr_thread_state(workspace_id,conversation_id,owner) VALUES(p_ws,t.conversation_id,'human')
   ON CONFLICT(workspace_id,conversation_id) DO UPDATE SET owner='human',revision=app.sdr_thread_state.revision+1,changed_by=NULL,changed_at=clock_timestamp();
  UPDATE app.sdr_turn SET state='handed-off',text=p_text,fields=coalesce(p_fields,'[]'),decided_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_turn;
  PERFORM app.sdr_notify(p_ws,member,'sdr-handoff:'||p_turn,'handoff','O Agente SDR passou uma conversa para você',href,p_now);
  RETURN 'handed-off';
 END IF;
 UPDATE app.sdr_turn SET state='abstained',reason=coalesce(p_reason,'ABSTAINED'),fields=coalesce(p_fields,'[]'),decided_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_turn;
 RETURN 'abstained';
END $$;
CREATE OR REPLACE FUNCTION app.sdr_retry_turn(p_turn text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.sdr_turn;
BEGIN
 PERFORM app.sdr_role(false);
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn AND state='uncertain' FOR UPDATE;
 IF NOT FOUND OR t.attempts>=3 OR NOT app.sdr_turn_eligible(t) THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 UPDATE app.sdr_turn SET state='queued',attempts=attempts+1,lease_token=NULL,lease_until=NULL,reason=NULL WHERE workspace_id=ws AND id=p_turn;
END $$;
-- Called inside the reply's transaction, before the enqueue. A refusal changes nothing.
CREATE FUNCTION app.sdr_check_approval(p_turn text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.sdr_turn;
BEGIN
 PERFORM app.sdr_role(false);
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sdr-conversation:'||t.conversation_id,0));
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn FOR UPDATE;
 IF t.state<>'pending-approval' OR NOT app.sdr_thread_open(ws,t.conversation_id,t.inbound_message_id) THEN RAISE EXCEPTION 'SDR_STATE';END IF;
END $$;
CREATE FUNCTION app.sdr_approve_turn(p_turn text,p_message text,p_text text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.sdr_turn;
BEGIN
 PERFORM app.sdr_role(false);
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn AND state='pending-approval' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 IF t.reserved THEN PERFORM app.billing_consume('sdr-turn:'||t.id,'sdr',1,'sdr-turn:'||t.id),app.billing_release('sdr-turn:'||t.id);END IF;
 UPDATE app.sdr_turn SET state='sent',reserved=false,text=p_text,message_id=p_message,decided_by=current_setting('app.user_id',true),decided_at=clock_timestamp() WHERE workspace_id=ws AND id=p_turn;
END $$;
-- Pausing also drops what the agent left open: nothing approvable or holding quota survives it.
CREATE OR REPLACE FUNCTION app.sdr_pause(p_agent text,p_expected bigint) RETURNS app.sdr_agent
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.sdr_agent;t app.sdr_turn;
BEGIN
 PERFORM app.sdr_role(true);
 SELECT * INTO a FROM app.sdr_agent WHERE workspace_id=ws AND id=p_agent FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 IF a.revision<>p_expected THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 IF a.state<>'active' THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 DELETE FROM app.sdr_channel_binding WHERE workspace_id=ws AND agent_id=p_agent;
 FOR t IN SELECT * FROM app.sdr_turn WHERE workspace_id=ws AND agent_id=p_agent AND state IN('queued','claimed','pending-approval','uncertain') FOR UPDATE LOOP
  PERFORM app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='superseded',decided_at=clock_timestamp() WHERE workspace_id=ws AND id=t.id;
 END LOOP;
 UPDATE app.sdr_agent SET state='paused',revision=revision+1,activation_request=NULL,paused_at=clock_timestamp(),paused_by=current_setting('app.user_id',true),updated_at=clock_timestamp()
  WHERE workspace_id=ws AND id=p_agent RETURNING * INTO a;
 RETURN a;
END $$;
CREATE FUNCTION app.sdr_connection_in_service(p_connection text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.current_role() IS NOT NULL AND EXISTS(SELECT 1 FROM app.sdr_agent_for_connection(p_connection) a WHERE a.workspace_id=current_setting('app.workspace_id',true))
$$;
-- Retention reaches the draft and the qualification answers built from a purged message.
CREATE FUNCTION app.sdr_purge_turn_text() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.sdr_turn SET text=NULL,fields='[]' WHERE workspace_id=NEW.workspace_id AND (inbound_message_id=NEW.id OR message_id=NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER sdr_purge_turn_text AFTER UPDATE OF text_purged_at ON app.channel_message FOR EACH ROW WHEN(NEW.text_purged_at IS NOT NULL AND OLD.text_purged_at IS NULL) EXECUTE FUNCTION app.sdr_purge_turn_text();
REVOKE ALL ON FUNCTION app.sdr_thread_open(text,text,text),app.sdr_turn_eligible(app.sdr_turn),app.sdr_notify(text,text,text,text,text,text,timestamptz),app.sdr_check_approval(text),app.sdr_approve_turn(text,text,text),app.sdr_connection_in_service(text),app.sdr_purge_turn_text() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sdr_check_approval(text),app.sdr_approve_turn(text,text,text),app.sdr_connection_in_service(text) TO cadence_app;
