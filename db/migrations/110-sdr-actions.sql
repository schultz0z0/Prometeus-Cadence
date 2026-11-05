-- 07B.3: the agent's suggestions (no ids, nothing executed), meeting bookings on the real calendar service and
-- follow-ups with recorded consent. A follow-up is a draft turn: it still waits for a person. No CRM: no connector exists.
ALTER TABLE app.sdr_turn ADD COLUMN proposal jsonb,ADD COLUMN followup_attempt integer NOT NULL DEFAULT 0 CHECK(followup_attempt BETWEEN 0 AND 2),
 DROP CONSTRAINT sdr_turn_workspace_id_conversation_id_inbound_message_id_key,ADD UNIQUE(workspace_id,conversation_id,inbound_message_id,followup_attempt);
CREATE TABLE app.sdr_business_action(
 workspace_id text NOT NULL,id text NOT NULL DEFAULT gen_random_uuid()::text,conversation_id text NOT NULL,request_id text NOT NULL,lead_id text NOT NULL,slot_id text NOT NULL CHECK(length(slot_id)<=2000),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,request_id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES app.channel_conversation(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX sdr_business_action_conversation ON app.sdr_business_action(workspace_id,conversation_id,created_at DESC);
CREATE TABLE app.sdr_followup(
 workspace_id text NOT NULL,id text NOT NULL DEFAULT gen_random_uuid()::text,conversation_id text NOT NULL,identity_id text NOT NULL,inbound_message_id text NOT NULL,quote text NOT NULL CHECK(length(quote) BETWEEN 3 AND 500),
 purpose text NOT NULL DEFAULT 'conversation-followup',evidence_id text,state text NOT NULL DEFAULT 'active' CHECK(state IN('active','ended')),attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 2),next_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,ended_reason text,ended_at timestamptz,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES app.channel_conversation(workspace_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX sdr_followup_one_active ON app.sdr_followup(workspace_id,conversation_id) WHERE state='active';
CREATE INDEX sdr_followup_due ON app.sdr_followup(next_at) WHERE state='active';
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['sdr_business_action','sdr_followup'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
 EXECUTE format('CREATE POLICY ws_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
END LOOP;END $$;
GRANT SELECT ON app.sdr_business_action,app.sdr_followup TO cadence_app;

-- Follow-up is available now; responding without approval stays blocked until the pilot.
CREATE OR REPLACE FUNCTION app.sdr_activate(p_agent text,p_revision bigint,p_context integer,p_request text) RETURNS app.sdr_agent
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);a app.sdr_agent;c text;chs text[];kids text[];kn jsonb;
BEGIN
 PERFORM app.sdr_guard(true);
 SELECT * INTO a FROM app.sdr_agent WHERE workspace_id=ws AND id=p_agent FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 IF a.state='active' AND a.activation_request=p_request AND a.active_revision=p_revision THEN RETURN a;END IF;
 IF a.revision<>p_revision THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 IF p_context IS DISTINCT FROM (SELECT max(version) FROM app.context_version WHERE workspace_id=ws AND payload->>'approvedAt' IS NOT NULL) THEN RAISE EXCEPTION 'SDR_CHANGED';END IF;
 chs:=ARRAY(SELECT jsonb_array_elements_text(coalesce(a.draft->'channelIds','[]')));
 kids:=ARRAY(SELECT jsonb_array_elements_text(coalesce(a.draft->'knowledgeIds','[]')));
 IF coalesce(a.draft->>'approvalMode','')<>'all' OR length(trim(coalesce(a.draft->>'instructions','')))=0
  OR NOT EXISTS(SELECT 1 FROM auth.member m WHERE m."organizationId"=ws AND m."userId"=a.draft#>>'{handoff,memberId}')
  OR (SELECT count(*) FROM app.sdr_knowledge WHERE workspace_id=ws AND id=ANY(kids) AND state='approved')<>cardinality(kids)
  OR (EXISTS(SELECT 1 FROM app.channel_connection WHERE workspace_id=ws AND id=ANY(chs) AND provider='openwa') AND coalesce((a.draft->>'maxRepliesPerDay')::int,999)>20)
 THEN RAISE EXCEPTION 'SDR_POLICY';END IF;
 IF cardinality(chs)=0 THEN RAISE EXCEPTION 'SDR_CHANNEL';END IF;
 PERFORM 1 FROM app.channel_connection WHERE workspace_id=ws AND id=ANY(chs) ORDER BY id FOR UPDATE;
 FOREACH c IN ARRAY chs LOOP
  IF NOT app.sdr_channel_ready(ws,c) THEN RAISE EXCEPTION 'SDR_CHANNEL';END IF;
  IF EXISTS(SELECT 1 FROM app.sdr_channel_binding b WHERE b.workspace_id=ws AND b.connection_id=c AND b.agent_id<>p_agent) THEN RAISE EXCEPTION 'SDR_CHANNEL_TAKEN';END IF;
 END LOOP;
 kn:=coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'revision',revision) ORDER BY id) FROM app.sdr_knowledge WHERE workspace_id=ws AND id=ANY(kids)),'[]');
 INSERT INTO app.sdr_agent_revision(workspace_id,agent_id,revision,config,context_version,channel_ids,knowledge,created_by) VALUES(ws,p_agent,p_revision,a.draft,p_context,chs,kn,uid)
  ON CONFLICT(workspace_id,agent_id,revision) DO UPDATE SET config=EXCLUDED.config,context_version=EXCLUDED.context_version,channel_ids=EXCLUDED.channel_ids,knowledge=EXCLUDED.knowledge;
 DELETE FROM app.sdr_channel_binding WHERE workspace_id=ws AND agent_id=p_agent;
 BEGIN
  INSERT INTO app.sdr_channel_binding(workspace_id,connection_id,agent_id,revision) SELECT ws,x,p_agent,p_revision FROM unnest(chs) x;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'SDR_CHANNEL_TAKEN';
 END;
 UPDATE app.sdr_agent SET state='active',active_revision=p_revision,activation_request=p_request,activated_at=clock_timestamp(),activated_by=uid,paused_at=NULL,paused_by=NULL,updated_at=clock_timestamp()
  WHERE workspace_id=ws AND id=p_agent RETURNING * INTO a;
 RETURN a;
END $$;

-- Ending removes the consent evidence it created, so a later manual send does not lean on a withdrawn authorization.
CREATE FUNCTION app.sdr_followup_end(p_ws text,p_conversation text,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE f app.sdr_followup;
BEGIN
 SELECT * INTO f FROM app.sdr_followup WHERE workspace_id=p_ws AND conversation_id=p_conversation AND state='active' FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 UPDATE app.sdr_followup SET state='ended',ended_reason=p_reason,ended_at=clock_timestamp() WHERE workspace_id=p_ws AND id=f.id;
 IF f.evidence_id IS NOT NULL THEN DELETE FROM app.consent_evidence WHERE workspace_id=p_ws AND id=f.evidence_id;END IF;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_set_owner(p_conversation text,p_owner text,p_expected bigint) RETURNS bigint
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
 IF p_owner='human' THEN PERFORM app.sdr_supersede_open(ws,p_conversation,NULL),app.sdr_followup_end(ws,p_conversation,'HUMAN');END IF;
 INSERT INTO app.sdr_thread_state(workspace_id,conversation_id,owner,changed_by) VALUES(ws,p_conversation,p_owner,uid)
  ON CONFLICT(workspace_id,conversation_id) DO UPDATE SET owner=p_owner,revision=app.sdr_thread_state.revision+1,changed_by=uid,changed_at=clock_timestamp() RETURNING * INTO cur;
 RETURN cur.revision;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_turn_payload(t app.sdr_turn) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('workspaceId',t.workspace_id,'turnId',t.id,'config',r.config,
  'followup',CASE WHEN t.followup_attempt>0 THEN (SELECT jsonb_build_object('attempt',t.followup_attempt,'quote',f.quote) FROM app.sdr_followup f WHERE f.workspace_id=t.workspace_id AND f.conversation_id=t.conversation_id AND f.state='active') END,
  'context',(SELECT v.payload FROM app.context_version v WHERE v.workspace_id=t.workspace_id AND v.version=r.context_version),
  'knowledge',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',k.kind,'title',k.title,'body',k.body)) FROM app.sdr_knowledge k WHERE k.workspace_id=t.workspace_id AND k.state='approved' AND k.id IN(SELECT s->>'id' FROM jsonb_array_elements(r.knowledge) s)),'[]'),
  'incoming',(SELECT left(m.text,2000) FROM app.channel_message m WHERE m.workspace_id=t.workspace_id AND m.id=t.inbound_message_id),
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('direction',h.direction,'text',left(h.text,1000)) ORDER BY h.message_order) FROM (SELECT m.direction,m.text,m.message_order FROM app.channel_message m
    WHERE m.workspace_id=t.workspace_id AND m.conversation_id=t.conversation_id AND m.id<>t.inbound_message_id AND m.text IS NOT NULL AND m.text_purged_at IS NULL AND m.state NOT IN('failed','blocked','cancelled','uncertain') ORDER BY m.message_order DESC LIMIT 20) h),'[]'))
 FROM app.sdr_agent_revision r WHERE r.workspace_id=t.workspace_id AND r.agent_id=t.agent_id AND r.revision=t.agent_revision
$$;

-- Opens a turn: older open turns lose, the daily limit and the quota decide. NULL means it was recorded as blocked.
CREATE FUNCTION app.sdr_begin_turn(p_ws text,p_conversation text,p_inbound text,p_agent text,p_revision bigint,p_config jsonb,p_token text,p_now timestamptz,p_attempt integer) RETURNS app.sdr_turn
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.sdr_turn;
BEGIN
 INSERT INTO app.sdr_turn(workspace_id,conversation_id,inbound_message_id,agent_id,agent_revision,state,lease_token,lease_until,followup_attempt)
  VALUES(p_ws,p_conversation,p_inbound,p_agent,p_revision,'claimed',p_token,p_now+interval '5 minutes',p_attempt) ON CONFLICT DO NOTHING RETURNING * INTO t;
 IF t.id IS NULL THEN RETURN NULL;END IF;
 PERFORM app.sdr_act_as(p_ws),app.sdr_supersede_open(p_ws,p_conversation,t.id);
 IF (SELECT count(*) FROM app.sdr_turn u WHERE u.workspace_id=p_ws AND u.agent_id=p_agent AND u.state IN('pending-approval','sent') AND u.created_at>p_now-interval '1 day')>=(p_config->>'maxRepliesPerDay')::int THEN
  UPDATE app.sdr_turn SET state='blocked',reason='DAILY_LIMIT',decided_at=clock_timestamp() WHERE workspace_id=p_ws AND id=t.id;RETURN NULL;
 END IF;
 BEGIN
  PERFORM app.billing_reserve('sdr-turn:'||t.id,'sdr',1);
  UPDATE app.sdr_turn SET reserved=true WHERE workspace_id=p_ws AND id=t.id RETURNING * INTO t;
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT IN('BILLING_QUOTA','BILLING_REQUIRED') THEN RAISE;END IF;
  UPDATE app.sdr_turn SET state='blocked',reason='SDR_QUOTA',decided_at=clock_timestamp() WHERE workspace_id=p_ws AND id=t.id;RETURN NULL;
 END;
 RETURN t;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_claim_turn(p_token text,p_now timestamptz,p_workspace text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t app.sdr_turn;x record;f record;
BEGIN
 UPDATE app.sdr_turn SET state='uncertain',reason='WORKER_LOST' WHERE state='claimed' AND lease_until<=p_now AND (p_workspace IS NULL OR workspace_id=p_workspace);
 FOR t IN SELECT u.* FROM app.sdr_turn u JOIN app.channel_conversation cc ON cc.workspace_id=u.workspace_id AND cc.id=u.conversation_id
   WHERE u.state IN('pending-approval','uncertain') AND (p_workspace IS NULL OR u.workspace_id=p_workspace)
    AND (u.created_at<p_now-interval '7 days' OR EXISTS(SELECT 1 FROM app.contact_suppression c WHERE c.workspace_id=cc.workspace_id AND c.identity_id=cc.identity_id AND c.scope IN('all','service')))
   ORDER BY u.created_at LIMIT 50 FOR UPDATE OF u SKIP LOCKED LOOP
  PERFORM app.sdr_act_as(t.workspace_id),app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='superseded',decided_at=clock_timestamp() WHERE workspace_id=t.workspace_id AND id=t.id;
 END LOOP;
 -- Follow-ups that must stop. Meta's text window closes in 24 h and this flow has no template, so a due return there ends.
 FOR f IN SELECT s.workspace_id,s.conversation_id,CASE
    WHEN EXISTS(SELECT 1 FROM app.contact_suppression c WHERE c.workspace_id=s.workspace_id AND c.identity_id=s.identity_id AND c.scope IN('all','service')) THEN 'OPT_OUT'
    WHEN EXISTS(SELECT 1 FROM app.sdr_thread_state o WHERE o.workspace_id=s.workspace_id AND o.conversation_id=s.conversation_id AND o.owner='human') THEN 'HUMAN'
    WHEN s.inbound_message_id<>(SELECT i.id FROM app.channel_message i WHERE i.workspace_id=s.workspace_id AND i.conversation_id=s.conversation_id AND i.direction='inbound' ORDER BY i.message_order DESC LIMIT 1) THEN 'REPLIED'
    WHEN s.expires_at<=p_now THEN 'EXPIRED'
    WHEN s.next_at<=p_now AND s.attempts<2 AND cn.provider='meta' AND cc.last_inbound_at<p_now-interval '24 hours' THEN 'WINDOW_CLOSED' END reason
   FROM app.sdr_followup s JOIN app.channel_conversation cc ON cc.workspace_id=s.workspace_id AND cc.id=s.conversation_id JOIN app.channel_connection cn ON cn.workspace_id=cc.workspace_id AND cn.id=cc.connection_id
   WHERE s.state='active' AND (p_workspace IS NULL OR s.workspace_id=p_workspace) LIMIT 200 LOOP
  IF f.reason IS NOT NULL THEN PERFORM app.sdr_followup_end(f.workspace_id,f.conversation_id,f.reason);END IF;
 END LOOP;
 FOR t IN SELECT * FROM app.sdr_turn WHERE state='queued' AND (p_workspace IS NULL OR workspace_id=p_workspace) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20 LOOP
  IF app.sdr_turn_eligible(t) THEN
   UPDATE app.sdr_turn SET state='claimed',lease_token=p_token,lease_until=p_now+interval '5 minutes' WHERE workspace_id=t.workspace_id AND id=t.id RETURNING * INTO t;
   RETURN app.sdr_turn_payload(t);
  END IF;
  PERFORM app.sdr_act_as(t.workspace_id),app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='superseded',decided_at=clock_timestamp() WHERE workspace_id=t.workspace_id AND id=t.id;
 END LOOP;
 t:=NULL;
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
  CONTINUE WHEN NOT app.sdr_thread_open(x.workspace_id,x.conversation_id,x.inbound_id) OR EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=x.workspace_id AND u.conversation_id=x.conversation_id AND u.state='claimed');
  t:=app.sdr_begin_turn(x.workspace_id,x.conversation_id,x.inbound_id,x.agent_id,x.revision,x.config,p_token,p_now,0);
  IF t.id IS NOT NULL THEN RETURN app.sdr_turn_payload(t);END IF;
 END LOOP;
 -- Returns due: consent on file, agent still offering follow-up, in hours, and nothing already waiting for a person.
 FOR x IN SELECT s.workspace_id,s.id followup_id,s.conversation_id,s.inbound_message_id inbound_id,s.attempts,a.agent_id,a.revision,a.config FROM app.sdr_followup s
   JOIN app.channel_conversation cc ON cc.workspace_id=s.workspace_id AND cc.id=s.conversation_id
   CROSS JOIN LATERAL app.sdr_agent_for_connection(cc.connection_id) a
  WHERE s.state='active' AND s.attempts<2 AND s.next_at<=p_now AND s.expires_at>p_now AND (p_workspace IS NULL OR s.workspace_id=p_workspace)
   AND (a.config->>'followupEnabled')::boolean AND app.sdr_within_hours(a.config->'hours',p_now)
   AND NOT EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=s.workspace_id AND u.conversation_id=s.conversation_id AND u.state IN('claimed','queued','pending-approval','uncertain'))
  ORDER BY s.next_at LIMIT 50
 LOOP
  CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('sdr-conversation:'||x.conversation_id,0));
  CONTINUE WHEN NOT app.sdr_thread_open(x.workspace_id,x.conversation_id,x.inbound_id);
  UPDATE app.sdr_followup SET attempts=attempts+1,next_at=p_now+interval '24 hours' WHERE workspace_id=x.workspace_id AND id=x.followup_id;
  t:=app.sdr_begin_turn(x.workspace_id,x.conversation_id,x.inbound_id,x.agent_id,x.revision,x.config,p_token,p_now,x.attempts+1);
  IF t.id IS NOT NULL THEN RETURN app.sdr_turn_payload(t);END IF;
 END LOOP;
 RETURN NULL;
END $$;
DROP FUNCTION app.sdr_finish_turn(text,text,text,text,text,jsonb,jsonb,text,timestamptz);
CREATE FUNCTION app.sdr_finish_turn(p_ws text,p_turn text,p_token text,p_decision text,p_text text,p_fields jsonb,p_usage jsonb,p_reason text,p_now timestamptz,p_proposal jsonb) RETURNS text
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
  UPDATE app.sdr_turn SET state='pending-approval',text=p_text,fields=coalesce(p_fields,'[]'),reason=NULL,proposal=p_proposal WHERE workspace_id=p_ws AND id=p_turn;
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

-- The person records the authorization: a literal quote of the lead's latest message, on an agent that offers follow-up.
CREATE FUNCTION app.sdr_followup_record(p_conversation text,p_turn text,p_quote text,p_days integer) RETURNS app.sdr_followup
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);t app.sdr_turn;cc app.channel_conversation;f app.sdr_followup;msg app.channel_message;ev text:=gen_random_uuid()::text;
BEGIN
 PERFORM app.sdr_role(false);
 PERFORM pg_advisory_xact_lock(hashtextextended('sdr-conversation:'||p_conversation,0));
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn AND conversation_id=p_conversation;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 SELECT * INTO msg FROM app.channel_message WHERE workspace_id=ws AND id=t.inbound_message_id;
 IF msg.text IS NULL OR length(p_quote)<3 OR position(p_quote in msg.text)=0 THEN RAISE EXCEPTION 'SDR_QUOTE';END IF;
 IF NOT app.sdr_thread_open(ws,p_conversation,t.inbound_message_id) THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 SELECT * INTO cc FROM app.channel_conversation WHERE workspace_id=ws AND id=p_conversation;
 IF NOT EXISTS(SELECT 1 FROM app.sdr_agent_for_connection(cc.connection_id) a WHERE (a.config->>'followupEnabled')::boolean) THEN RAISE EXCEPTION 'SDR_FOLLOWUP_OFF';END IF;
 PERFORM app.sdr_followup_end(ws,p_conversation,'REPLACED');
 INSERT INTO app.consent_evidence(workspace_id,id,identity_id,purpose,source,occurred_at,evidence,actor_id) VALUES(ws,ev,cc.identity_id,'service','sdr-followup',msg.occurred_at,p_quote,uid);
 INSERT INTO app.sdr_followup(workspace_id,conversation_id,identity_id,inbound_message_id,quote,evidence_id,next_at,expires_at,created_by)
  VALUES(ws,p_conversation,cc.identity_id,t.inbound_message_id,p_quote,ev,clock_timestamp()+interval '24 hours',clock_timestamp()+make_interval(days=>p_days),uid) RETURNING * INTO f;
 RETURN f;
END $$;
CREATE FUNCTION app.sdr_followup_revoke(p_conversation text,p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 PERFORM app.sdr_role(false);
 IF NOT EXISTS(SELECT 1 FROM app.sdr_followup WHERE workspace_id=ws AND id=p_id AND conversation_id=p_conversation AND state='active') THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 PERFORM app.sdr_followup_end(ws,p_conversation,'WITHDRAWN');
END $$;
-- A booking in flight counts for 10 minutes; once the reservation exists its own state decides.
CREATE FUNCTION app.sdr_booking_active(p_conversation text,p_request text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.sdr_business_action b LEFT JOIN app.calendar_reservation r ON r.workspace_id=b.workspace_id AND r.request_id=b.request_id
  WHERE b.workspace_id=current_setting('app.workspace_id',true) AND b.conversation_id=p_conversation AND b.request_id IS DISTINCT FROM p_request AND app.current_role() IS NOT NULL
   AND (r.state IN('prepared','accepted','uncertain') OR (r.id IS NULL AND b.created_at>clock_timestamp()-interval '10 minutes')))
$$;
CREATE FUNCTION app.sdr_booking_begin(p_conversation text,p_request text,p_lead text,p_slot text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 PERFORM app.sdr_role(false);
 PERFORM pg_advisory_xact_lock(hashtextextended('sdr-conversation:'||p_conversation,0));
 IF app.sdr_booking_active(p_conversation,p_request) THEN RAISE EXCEPTION 'SDR_BOOKING_ACTIVE';END IF;
 INSERT INTO app.sdr_business_action(workspace_id,conversation_id,request_id,lead_id,slot_id,created_by) VALUES(ws,p_conversation,p_request,p_lead,p_slot,current_setting('app.user_id',true)) ON CONFLICT(workspace_id,request_id) DO NOTHING;
END $$;
-- The calendar refused before creating a reservation: nothing is in flight.
CREATE FUNCTION app.sdr_booking_abort(p_request text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 DELETE FROM app.sdr_business_action b WHERE b.workspace_id=current_setting('app.workspace_id',true) AND b.request_id=p_request AND app.current_role() IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM app.calendar_reservation r WHERE r.workspace_id=b.workspace_id AND r.request_id=b.request_id)
$$;
REVOKE ALL ON FUNCTION app.sdr_followup_end(text,text,text),app.sdr_begin_turn(text,text,text,text,bigint,jsonb,text,timestamptz,integer),app.sdr_finish_turn(text,text,text,text,text,jsonb,jsonb,text,timestamptz,jsonb),
 app.sdr_followup_record(text,text,text,integer),app.sdr_followup_revoke(text,text),app.sdr_booking_active(text,text),app.sdr_booking_begin(text,text,text,text),app.sdr_booking_abort(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sdr_followup_record(text,text,text,integer),app.sdr_followup_revoke(text,text),app.sdr_booking_active(text,text),app.sdr_booking_begin(text,text,text,text),app.sdr_booking_abort(text) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.sdr_finish_turn(text,text,text,text,text,jsonb,jsonb,text,timestamptz,jsonb) TO cadence_worker;
