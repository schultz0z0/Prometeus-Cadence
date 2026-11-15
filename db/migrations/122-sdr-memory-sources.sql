-- SDR long memory and sources (15/11/2026): conversation summary and lead facts live in the thread state;
-- each turn keeps the knowledge passages it cited and alerts for values without an approved source.
ALTER TABLE app.sdr_thread_state ADD COLUMN summary text CHECK(length(summary)<=1500),ADD COLUMN facts jsonb NOT NULL DEFAULT '[]';
ALTER TABLE app.sdr_turn ADD COLUMN sources jsonb NOT NULL DEFAULT '[]',ADD COLUMN alerts jsonb NOT NULL DEFAULT '[]';

CREATE OR REPLACE FUNCTION app.sdr_turn_payload(t app.sdr_turn) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('workspaceId',t.workspace_id,'turnId',t.id,'config',r.config,'incomingId',t.inbound_message_id,
  'summary',(SELECT s.summary FROM app.sdr_thread_state s WHERE s.workspace_id=t.workspace_id AND s.conversation_id=t.conversation_id),
  'facts',coalesce((SELECT s.facts FROM app.sdr_thread_state s WHERE s.workspace_id=t.workspace_id AND s.conversation_id=t.conversation_id),'[]'),
  'meeting',(SELECT to_char(r2.start_at AT TIME ZONE r2.timezone,'YYYY-MM-DD HH24:MI') FROM app.sdr_business_action a2 JOIN app.calendar_reservation r2 ON r2.workspace_id=a2.workspace_id AND r2.request_id=a2.request_id WHERE a2.workspace_id=t.workspace_id AND a2.conversation_id=t.conversation_id AND r2.state='accepted' AND r2.end_at>clock_timestamp() ORDER BY r2.start_at LIMIT 1),
  'followup',CASE WHEN t.followup_attempt>0 THEN (SELECT jsonb_build_object('attempt',t.followup_attempt,'quote',f.quote) FROM app.sdr_followup f WHERE f.workspace_id=t.workspace_id AND f.conversation_id=t.conversation_id AND f.state='active') END,
  'context',(SELECT v.payload FROM app.context_version v WHERE v.workspace_id=t.workspace_id AND v.version=r.context_version),
  'knowledge',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',k.kind,'title',k.title,'body',k.body)) FROM app.sdr_knowledge k WHERE k.workspace_id=t.workspace_id AND k.state='approved' AND k.id IN(SELECT s->>'id' FROM jsonb_array_elements(r.knowledge) s)),'[]'),
  'incoming',(SELECT left(m.text,2000) FROM app.channel_message m WHERE m.workspace_id=t.workspace_id AND m.id=t.inbound_message_id),
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'direction',h.direction,'text',left(h.text,1000)) ORDER BY h.message_order) FROM (SELECT m.id,m.direction,m.text,m.message_order FROM app.channel_message m
    WHERE m.workspace_id=t.workspace_id AND m.conversation_id=t.conversation_id AND m.id<>t.inbound_message_id AND m.text IS NOT NULL AND m.text_purged_at IS NULL AND m.state NOT IN('failed','blocked','cancelled','uncertain') ORDER BY m.message_order DESC LIMIT 20) h),'[]'))
 FROM app.sdr_agent_revision r WHERE r.workspace_id=t.workspace_id AND r.agent_id=t.agent_id AND r.revision=t.agent_revision
$$;


-- Same contract as before plus memory. The 10-argument version still decides the turn; this one also records memory and sources
-- when the decision produced a draft or a handoff (never on lost/superseded/uncertain turns).
CREATE FUNCTION app.sdr_finish_turn(p_ws text,p_turn text,p_token text,p_decision text,p_text text,p_fields jsonb,p_usage jsonb,p_reason text,p_now timestamptz,p_proposal jsonb,p_memory jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r text:=app.sdr_finish_turn(p_ws,p_turn,p_token,p_decision,p_text,p_fields,p_usage,p_reason,p_now,p_proposal);conv text;
BEGIN
 IF r NOT IN('pending-approval','handed-off','abstained') OR p_memory IS NULL THEN RETURN r;END IF;
 UPDATE app.sdr_turn SET sources=coalesce(p_memory->'sources','[]'),alerts=coalesce(p_memory->'alerts','[]') WHERE workspace_id=p_ws AND id=p_turn RETURNING conversation_id INTO conv;
 INSERT INTO app.sdr_thread_state(workspace_id,conversation_id,summary,facts) VALUES(p_ws,conv,left(p_memory->>'summary',1500),coalesce(p_memory->'facts','[]'))
  ON CONFLICT(workspace_id,conversation_id) DO UPDATE SET summary=coalesce(left(p_memory->>'summary',1500),app.sdr_thread_state.summary),facts=coalesce(p_memory->'facts',app.sdr_thread_state.facts);
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION app.sdr_finish_turn(text,text,text,text,text,jsonb,jsonb,text,timestamptz,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sdr_finish_turn(text,text,text,text,text,jsonb,jsonb,text,timestamptz,jsonb,jsonb) TO cadence_worker;
