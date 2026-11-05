-- 07B.3 review. Consent is owner/admin's and only on the AI's own proposal; Meta is refused up front (no template here);
-- pacing also holds at approval; ending a follow-up drops its open returns; attempts count only real drafts; sweeps and
-- candidates apply their gates before the limit; retention reaches the quote; bookings cannot block forever.
CREATE OR REPLACE FUNCTION app.sdr_followup_end(p_ws text,p_conversation text,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE f app.sdr_followup;t app.sdr_turn;
BEGIN
 SELECT * INTO f FROM app.sdr_followup WHERE workspace_id=p_ws AND conversation_id=p_conversation AND state='active' FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 UPDATE app.sdr_followup SET state='ended',ended_reason=p_reason,ended_at=clock_timestamp(),
  expires_at=CASE WHEN p_reason IN('COMPLETED','MANUAL_REPLY') THEN least(expires_at,clock_timestamp()+interval '1 day') ELSE expires_at END WHERE workspace_id=p_ws AND id=f.id;
 FOR t IN SELECT * FROM app.sdr_turn WHERE workspace_id=p_ws AND conversation_id=p_conversation AND followup_attempt>0 AND state IN('queued','claimed','pending-approval','uncertain') FOR UPDATE LOOP
  PERFORM app.sdr_release_turn(t);UPDATE app.sdr_turn SET state='superseded',decided_at=clock_timestamp() WHERE workspace_id=p_ws AND id=t.id;
 END LOOP;
 -- A message just accepted on this consent still needs it at dispatch; the sweep removes it after the short validity.
 IF f.evidence_id IS NOT NULL AND p_reason NOT IN('COMPLETED','MANUAL_REPLY') THEN DELETE FROM app.consent_evidence WHERE workspace_id=p_ws AND id=f.evidence_id;END IF;
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
 IF p_owner='human' THEN PERFORM app.sdr_supersede_open(ws,p_conversation,NULL),app.sdr_followup_end(ws,p_conversation,CASE WHEN p_expected IS NULL THEN 'MANUAL_REPLY' ELSE 'HUMAN' END);END IF;
 INSERT INTO app.sdr_thread_state(workspace_id,conversation_id,owner,changed_by) VALUES(ws,p_conversation,p_owner,uid)
  ON CONFLICT(workspace_id,conversation_id) DO UPDATE SET owner=p_owner,revision=app.sdr_thread_state.revision+1,changed_by=uid,changed_at=clock_timestamp() RETURNING * INTO cur;
 RETURN cur.revision;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_turn_payload(t app.sdr_turn) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('workspaceId',t.workspace_id,'turnId',t.id,'config',r.config,
  'meeting',(SELECT to_char(r2.start_at AT TIME ZONE r2.timezone,'YYYY-MM-DD HH24:MI') FROM app.sdr_business_action a2 JOIN app.calendar_reservation r2 ON r2.workspace_id=a2.workspace_id AND r2.request_id=a2.request_id WHERE a2.workspace_id=t.workspace_id AND a2.conversation_id=t.conversation_id AND r2.state='accepted' AND r2.end_at>clock_timestamp() ORDER BY r2.start_at LIMIT 1),
  'followup',CASE WHEN t.followup_attempt>0 THEN (SELECT jsonb_build_object('attempt',t.followup_attempt,'quote',f.quote) FROM app.sdr_followup f WHERE f.workspace_id=t.workspace_id AND f.conversation_id=t.conversation_id AND f.state='active') END,
  'context',(SELECT v.payload FROM app.context_version v WHERE v.workspace_id=t.workspace_id AND v.version=r.context_version),
  'knowledge',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',k.kind,'title',k.title,'body',k.body)) FROM app.sdr_knowledge k WHERE k.workspace_id=t.workspace_id AND k.state='approved' AND k.id IN(SELECT s->>'id' FROM jsonb_array_elements(r.knowledge) s)),'[]'),
  'incoming',(SELECT left(m.text,2000) FROM app.channel_message m WHERE m.workspace_id=t.workspace_id AND m.id=t.inbound_message_id),
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('direction',h.direction,'text',left(h.text,1000)) ORDER BY h.message_order) FROM (SELECT m.direction,m.text,m.message_order FROM app.channel_message m
    WHERE m.workspace_id=t.workspace_id AND m.conversation_id=t.conversation_id AND m.id<>t.inbound_message_id AND m.text IS NOT NULL AND m.text_purged_at IS NULL AND m.state NOT IN('failed','blocked','cancelled','uncertain') ORDER BY m.message_order DESC LIMIT 20) h),'[]'))
 FROM app.sdr_agent_revision r WHERE r.workspace_id=t.workspace_id AND r.agent_id=t.agent_id AND r.revision=t.agent_revision
$$;
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
 -- Follow-ups that must stop; only those rows compete for the window.
 FOR f IN SELECT q.* FROM (SELECT s.workspace_id,s.conversation_id,s.next_at,CASE
    WHEN EXISTS(SELECT 1 FROM app.contact_suppression c WHERE c.workspace_id=s.workspace_id AND c.identity_id=s.identity_id AND c.scope IN('all','service')) THEN 'OPT_OUT'
    WHEN EXISTS(SELECT 1 FROM app.sdr_thread_state o WHERE o.workspace_id=s.workspace_id AND o.conversation_id=s.conversation_id AND o.owner='human') THEN 'HUMAN'
    WHEN s.inbound_message_id<>(SELECT i.id FROM app.channel_message i WHERE i.workspace_id=s.workspace_id AND i.conversation_id=s.conversation_id AND i.direction='inbound' ORDER BY i.message_order DESC LIMIT 1) THEN 'REPLIED'
    WHEN s.expires_at<=p_now THEN 'EXPIRED'
    WHEN NOT EXISTS(SELECT 1 FROM app.sdr_channel_binding b JOIN app.sdr_agent_revision r ON r.workspace_id=b.workspace_id AND r.agent_id=b.agent_id AND r.revision=b.revision WHERE b.workspace_id=s.workspace_id AND b.connection_id=cc.connection_id AND (r.config->>'followupEnabled')::boolean) THEN 'AGENT_OFF' END reason
   FROM app.sdr_followup s JOIN app.channel_conversation cc ON cc.workspace_id=s.workspace_id AND cc.id=s.conversation_id
   WHERE s.state='active' AND (p_workspace IS NULL OR s.workspace_id=p_workspace)) q WHERE q.reason IS NOT NULL ORDER BY q.next_at LIMIT 100 LOOP
  PERFORM app.sdr_act_as(f.workspace_id),app.sdr_followup_end(f.workspace_id,f.conversation_id,f.reason);
 END LOOP;
 -- Evidence kept for an accepted message goes once its short validity passes.
 DELETE FROM app.consent_evidence e USING app.sdr_followup s WHERE e.workspace_id=s.workspace_id AND e.id=s.evidence_id AND s.state='ended' AND s.expires_at<=p_now AND (p_workspace IS NULL OR s.workspace_id=p_workspace);
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
 -- Returns due: consent on file, agent still offering follow-up, in hours, nothing waiting for a person. Every gate before the limit.
 FOR x IN SELECT s.workspace_id,s.id followup_id,s.conversation_id,s.inbound_message_id inbound_id,s.attempts,a.agent_id,a.revision,a.config FROM app.sdr_followup s
   JOIN app.channel_conversation cc ON cc.workspace_id=s.workspace_id AND cc.id=s.conversation_id
   CROSS JOIN LATERAL app.sdr_agent_for_connection(cc.connection_id) a
  WHERE s.state='active' AND s.attempts<2 AND s.next_at<=p_now AND s.expires_at>p_now AND (p_workspace IS NULL OR s.workspace_id=p_workspace)
   AND (a.config->>'followupEnabled')::boolean AND app.sdr_within_hours(a.config->'hours',p_now) AND app.sdr_thread_open(s.workspace_id,s.conversation_id,s.inbound_message_id)
   AND EXISTS(SELECT 1 FROM auth.member mm WHERE mm."organizationId"=s.workspace_id)
   AND NOT EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=s.workspace_id AND u.conversation_id=s.conversation_id AND u.state IN('claimed','queued','pending-approval','uncertain'))
  ORDER BY s.next_at LIMIT 50
 LOOP
  CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('sdr-conversation:'||x.conversation_id,0));
  -- Re-read under the lock: another worker or a withdrawal may have got here first.
  CONTINUE WHEN NOT EXISTS(SELECT 1 FROM app.sdr_followup s WHERE s.workspace_id=x.workspace_id AND s.id=x.followup_id AND s.state='active' AND s.attempts=x.attempts AND s.next_at<=p_now)
   OR NOT app.sdr_thread_open(x.workspace_id,x.conversation_id,x.inbound_id);
  t:=app.sdr_begin_turn(x.workspace_id,x.conversation_id,x.inbound_id,x.agent_id,x.revision,x.config,p_token,p_now,x.attempts+1);
  IF t.id IS NOT NULL THEN
   UPDATE app.sdr_followup SET attempts=attempts+1,next_at=p_now+interval '24 hours' WHERE workspace_id=x.workspace_id AND id=x.followup_id;
   RETURN app.sdr_turn_payload(t);
  END IF;
  -- Blocked by limit or quota: no attempt spent, the consent tries again tomorrow within its validity.
  DELETE FROM app.sdr_turn WHERE workspace_id=x.workspace_id AND conversation_id=x.conversation_id AND inbound_message_id=x.inbound_id AND followup_attempt=x.attempts+1 AND state='blocked';
  UPDATE app.sdr_followup SET next_at=p_now+interval '24 hours' WHERE workspace_id=x.workspace_id AND id=x.followup_id;
 END LOOP;
 RETURN NULL;
END $$;

-- A return is only eligible while its consent is alive.
CREATE OR REPLACE FUNCTION app.sdr_turn_eligible(t app.sdr_turn) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.sdr_thread_open(t.workspace_id,t.conversation_id,t.inbound_message_id)
  AND EXISTS(SELECT 1 FROM app.channel_conversation cc,app.sdr_agent_for_connection(cc.connection_id) a WHERE cc.workspace_id=t.workspace_id AND cc.id=t.conversation_id AND a.agent_id=t.agent_id AND a.revision=t.agent_revision)
  AND (t.followup_attempt=0 OR EXISTS(SELECT 1 FROM app.sdr_followup f WHERE f.workspace_id=t.workspace_id AND f.conversation_id=t.conversation_id AND f.state='active' AND f.expires_at>clock_timestamp()))
$$;
CREATE OR REPLACE FUNCTION app.sdr_check_approval(p_turn text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.sdr_turn;
BEGIN
 PERFORM app.sdr_role(false);
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sdr-conversation:'||t.conversation_id,0));
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn FOR UPDATE;
 IF t.state<>'pending-approval' OR NOT app.sdr_thread_open(ws,t.conversation_id,t.inbound_message_id) THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 IF t.followup_attempt>0 THEN
  IF NOT EXISTS(SELECT 1 FROM app.sdr_followup f WHERE f.workspace_id=ws AND f.conversation_id=t.conversation_id AND f.state='active' AND f.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'SDR_STATE';END IF;
  IF EXISTS(SELECT 1 FROM app.channel_message o WHERE o.workspace_id=ws AND o.conversation_id=t.conversation_id AND o.direction='outbound' AND o.state NOT IN('failed','blocked','cancelled') AND o.created_at>clock_timestamp()-interval '24 hours') THEN RAISE EXCEPTION 'SDR_FOLLOWUP_TOO_SOON';END IF;
 -- The recorded consent is for returns, not for a late answer to the original message outside the window.
 ELSIF EXISTS(SELECT 1 FROM app.sdr_followup f JOIN app.channel_conversation cc ON cc.workspace_id=f.workspace_id AND cc.id=f.conversation_id WHERE f.workspace_id=ws AND f.conversation_id=t.conversation_id AND f.state='active' AND cc.last_inbound_at<clock_timestamp()-interval '24 hours') THEN RAISE EXCEPTION 'SDR_STATE';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_approve_turn(p_turn text,p_message text,p_text text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.sdr_turn;
BEGIN
 PERFORM app.sdr_role(false);
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn AND state='pending-approval' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 IF t.reserved THEN PERFORM app.billing_consume('sdr-turn:'||t.id,'sdr',1,'sdr-turn:'||t.id),app.billing_release('sdr-turn:'||t.id);END IF;
 UPDATE app.sdr_turn SET state='sent',reserved=false,text=p_text,message_id=p_message,decided_by=current_setting('app.user_id',true),decided_at=clock_timestamp() WHERE workspace_id=ws AND id=p_turn;
 -- 24 h count from what actually went out, not from when the draft was written.
 UPDATE app.sdr_followup SET next_at=clock_timestamp()+interval '24 hours' WHERE workspace_id=ws AND conversation_id=t.conversation_id AND state='active';
 IF t.followup_attempt>=2 THEN PERFORM app.sdr_followup_end(ws,t.conversation_id,'COMPLETED');END IF;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_reject_turn(p_turn text) RETURNS app.sdr_turn LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.sdr_turn;
BEGIN
 PERFORM app.sdr_role(false);
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn AND state='pending-approval' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 PERFORM app.sdr_release_turn(t);
 UPDATE app.sdr_turn SET state='rejected',decided_by=current_setting('app.user_id',true),decided_at=clock_timestamp() WHERE workspace_id=ws AND id=p_turn RETURNING * INTO t;
 -- Rejecting a return means no more returns: the next day must not bring another draft.
 IF t.followup_attempt>0 THEN PERFORM app.sdr_followup_end(ws,t.conversation_id,'REJECTED');END IF;
 RETURN t;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_followup_record(p_conversation text,p_turn text,p_quote text,p_days integer) RETURNS app.sdr_followup
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);t app.sdr_turn;cc app.channel_conversation;f app.sdr_followup;msg app.channel_message;ev text:=gen_random_uuid()::text;provider text;
BEGIN
 PERFORM app.sdr_role(true);
 PERFORM pg_advisory_xact_lock(hashtextextended('sdr-conversation:'||p_conversation,0));
 SELECT * INTO t FROM app.sdr_turn WHERE workspace_id=ws AND id=p_turn AND conversation_id=p_conversation;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 SELECT * INTO cc FROM app.channel_conversation WHERE workspace_id=ws AND id=p_conversation;
 IF NOT EXISTS(SELECT 1 FROM app.sdr_agent_for_connection(cc.connection_id) a WHERE (a.config->>'followupEnabled')::boolean) THEN RAISE EXCEPTION 'SDR_FOLLOWUP_OFF';END IF;
 SELECT cn.provider INTO provider FROM app.channel_connection cn WHERE cn.workspace_id=ws AND cn.id=cc.connection_id;
 IF provider<>'openwa' THEN RAISE EXCEPTION 'SDR_FOLLOWUP_META';END IF;
 SELECT * INTO msg FROM app.channel_message WHERE workspace_id=ws AND id=t.inbound_message_id;
 IF p_days NOT BETWEEN 1 AND 30 OR t.proposal->>'kind' IS DISTINCT FROM 'followup-consent' OR t.proposal->>'quote' IS DISTINCT FROM p_quote OR msg.text IS NULL OR position(p_quote in msg.text)=0 THEN RAISE EXCEPTION 'SDR_QUOTE';END IF;
 IF NOT app.sdr_thread_open(ws,p_conversation,t.inbound_message_id) OR EXISTS(SELECT 1 FROM app.sdr_turn u WHERE u.workspace_id=ws AND u.conversation_id=p_conversation AND u.inbound_message_id=t.inbound_message_id AND u.followup_attempt>0) THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 PERFORM app.sdr_followup_end(ws,p_conversation,'REPLACED');
 INSERT INTO app.consent_evidence(workspace_id,id,identity_id,purpose,source,occurred_at,evidence,actor_id) VALUES(ws,ev,cc.identity_id,'service','sdr-followup',msg.occurred_at,p_quote,uid);
 INSERT INTO app.sdr_followup(workspace_id,conversation_id,identity_id,inbound_message_id,quote,evidence_id,next_at,expires_at,created_by)
  VALUES(ws,p_conversation,cc.identity_id,t.inbound_message_id,p_quote,ev,clock_timestamp()+interval '24 hours',clock_timestamp()+make_interval(days=>p_days),uid) RETURNING * INTO f;
 RETURN f;
END $$;
CREATE OR REPLACE FUNCTION app.sdr_followup_revoke(p_conversation text,p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 PERFORM app.sdr_role(false);
 PERFORM pg_advisory_xact_lock(hashtextextended('sdr-conversation:'||p_conversation,0));
 IF NOT EXISTS(SELECT 1 FROM app.sdr_followup WHERE workspace_id=ws AND id=p_id AND conversation_id=p_conversation AND state='active') THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 PERFORM app.sdr_followup_end(ws,p_conversation,'WITHDRAWN');
END $$;
-- A past meeting no longer blocks the next one.
CREATE OR REPLACE FUNCTION app.sdr_booking_active(p_conversation text,p_request text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.sdr_business_action b LEFT JOIN app.calendar_reservation r ON r.workspace_id=b.workspace_id AND r.request_id=b.request_id
  WHERE b.workspace_id=current_setting('app.workspace_id',true) AND b.conversation_id=p_conversation AND b.request_id IS DISTINCT FROM p_request AND app.current_role() IS NOT NULL
   AND (r.state IN('prepared','uncertain') OR (r.state='accepted' AND r.end_at>clock_timestamp()) OR (r.id IS NULL AND b.created_at>clock_timestamp()-interval '10 minutes')))
$$;
DROP FUNCTION app.sdr_booking_abort(text);
CREATE FUNCTION app.sdr_booking_abort(p_conversation text,p_request text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 DELETE FROM app.sdr_business_action b WHERE b.workspace_id=current_setting('app.workspace_id',true) AND b.conversation_id=p_conversation AND b.request_id=p_request AND b.created_by=current_setting('app.user_id',true) AND app.current_role() IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM app.calendar_reservation r WHERE r.workspace_id=b.workspace_id AND r.request_id=b.request_id)
$$;
CREATE OR REPLACE FUNCTION app.sdr_booking_view(p_conversation text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',r.id,'start',to_char(r.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'end',to_char(r.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'state',r.state,'revision',r.revision,'timezone',r.timezone)
 FROM app.sdr_business_action a JOIN app.calendar_reservation r ON r.workspace_id=a.workspace_id AND r.request_id=a.request_id
 WHERE a.workspace_id=current_setting('app.workspace_id',true) AND a.conversation_id=p_conversation AND app.current_role() IS NOT NULL ORDER BY a.created_at DESC,a.id LIMIT 1
$$;
-- Retention also reaches the lead's quoted words, wherever they were copied to.
CREATE OR REPLACE FUNCTION app.sdr_purge_turn_text() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.sdr_turn SET text=NULL,fields='[]',proposal=NULL WHERE workspace_id=NEW.workspace_id AND (inbound_message_id=NEW.id OR message_id=NEW.id);
 UPDATE app.consent_evidence e SET evidence='[removido]' FROM app.sdr_followup f WHERE f.workspace_id=NEW.workspace_id AND f.inbound_message_id=NEW.id AND e.workspace_id=f.workspace_id AND e.id=f.evidence_id;
 UPDATE app.sdr_followup SET quote='[removido]' WHERE workspace_id=NEW.workspace_id AND inbound_message_id=NEW.id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.sdr_booking_abort(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sdr_booking_abort(text,text) TO cadence_app;
