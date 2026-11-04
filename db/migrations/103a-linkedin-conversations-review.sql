-- 07A.3a review. The message sync keys on the Unipile message id (the same id a sent reply returns), pages through
-- every new message across ticks, re-links a cached chat once its person joins a campaign, and only counts as a reply
-- what arrived after the invite. An opt-out covers every campaign row of that LinkedIn person and stops an invite in flight.
ALTER TABLE app.linkedin_thread ADD COLUMN attendee_id text;
ALTER TABLE app.linkedin_account ADD COLUMN messages_page_cursor text,ADD COLUMN messages_pending_newest timestamptz;

CREATE OR REPLACE FUNCTION app.claim_linkedin_invite(p_token text,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE acc record;a app.linkedin_account;pr record;d date:=(p_now AT TIME ZONE 'America/Sao_Paulo')::date;used integer;
BEGIN
 -- A crash between the claim and its result: the send may have left. Uncertain, never resent.
 WITH stale AS(UPDATE app.linkedin_campaign_person SET state='uncertain',op_token=NULL,reason='Sem confirmação do LinkedIn; o convite não será reenviado.',invited_at=coalesce(invited_at,p_now),updated_at=clock_timestamp()
   WHERE state='sending' AND updated_at<clock_timestamp()-interval '5 minutes' RETURNING workspace_id,id,campaign_id)
 , ops AS(UPDATE app.linkedin_invite_operation o SET state='uncertain' FROM stale WHERE o.workspace_id=stale.workspace_id AND o.person_id=stale.id AND o.state='sending' RETURNING 1)
 INSERT INTO app.linkedin_campaign_event(workspace_id,campaign_id,person_id,kind,at) SELECT workspace_id,campaign_id,id,'uncertain',p_now FROM stale ON CONFLICT DO NOTHING;
 FOR acc IN SELECT DISTINCT c.workspace_id,c.account_id,la.external_member_id FROM app.linkedin_campaign c JOIN app.linkedin_account la ON la.workspace_id=c.workspace_id AND la.id=c.account_id
   WHERE c.state='active' AND la.state='ready' ORDER BY la.external_member_id,c.workspace_id,c.account_id LOOP
  -- Another worker on this LinkedIn member: skip it this round instead of waiting (no lock cycles).
  CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('linkedin-invite:'||acc.external_member_id,0));
  SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=acc.workspace_id AND id=acc.account_id FOR UPDATE;
  CONTINUE WHEN a.state<>'ready' OR a.invite_hold_until>p_now OR a.last_invite_at>p_now-interval '20 minutes';
  SELECT count(*) INTO used FROM app.linkedin_invite_operation WHERE member_id=a.external_member_id AND day=d AND state<>'failed';
  CONTINUE WHEN used>=12;
  LOOP
   SELECT p.*,c.draft INTO pr FROM app.linkedin_campaign_person p JOIN app.linkedin_campaign c ON c.workspace_id=p.workspace_id AND c.id=p.campaign_id
    WHERE c.workspace_id=a.workspace_id AND c.account_id=a.id AND c.state='active' AND p.state='queued' AND p.opted_out_at IS NULL
     AND (SELECT count(*) FROM app.linkedin_invite_operation o WHERE o.workspace_id=c.workspace_id AND o.campaign_id=c.id AND o.day=d AND o.state<>'failed')<(c.draft->>'dailyLimit')::int
    ORDER BY c.activated_at,p.created_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED;
   EXIT WHEN NOT FOUND;
   BEGIN
    INSERT INTO app.linkedin_invite_operation(workspace_id,account_id,member_id,external_id,campaign_id,person_id,state,day) VALUES(a.workspace_id,a.id,a.external_member_id,pr.external_id,pr.campaign_id,pr.id,'sending',d);
   EXCEPTION WHEN unique_violation THEN
    UPDATE app.linkedin_campaign_person SET state='skipped',reason='Já convidado por esta conta LinkedIn.',updated_at=clock_timestamp() WHERE workspace_id=pr.workspace_id AND id=pr.id;
    CONTINUE;
   END;
   UPDATE app.linkedin_campaign_person SET state='sending',op_token=p_token,updated_at=clock_timestamp() WHERE workspace_id=pr.workspace_id AND id=pr.id;
   UPDATE app.linkedin_account SET prev_invite_at=last_invite_at,last_invite_at=p_now WHERE workspace_id=a.workspace_id AND id=a.id;
   RETURN jsonb_build_object('workspaceId',a.workspace_id,'accountId',a.id,'external',a.external_account_id,'epoch',a.credential_epoch,'capabilitiesVersion',a.capabilities_version,
    'campaignId',pr.campaign_id,'personId',pr.id,'providerId',pr.external_id,'name',pr.name,'company',pr.company,'headline',pr.headline,'industry',pr.industry,
    'note',pr.draft->>'note','proof',pr.draft->>'proof');
  END LOOP;
 END LOOP;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION app.linkedin_invite_recheck(p_ws text,p_person text,p_token text,p_epoch bigint,p_caps text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.linkedin_campaign_person;ok boolean;
BEGIN
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND id=p_person AND op_token=p_token AND state='sending' FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 SELECT EXISTS(SELECT 1 FROM app.linkedin_campaign c JOIN app.linkedin_account a ON a.workspace_id=c.workspace_id AND a.id=c.account_id
  WHERE c.workspace_id=p_ws AND c.id=p.campaign_id AND c.state='active' AND p.opted_out_at IS NULL AND a.state='ready' AND a.credential_epoch=p_epoch AND p_caps IS NOT NULL AND a.capabilities_version=p_caps) INTO ok;
 IF ok THEN RETURN true;END IF;
 DELETE FROM app.linkedin_invite_operation WHERE workspace_id=p_ws AND person_id=p_person AND state='sending';
 UPDATE app.linkedin_campaign_person SET state=CASE WHEN opted_out_at IS NULL THEN 'queued' ELSE 'skipped' END,reason=CASE WHEN opted_out_at IS NULL THEN reason ELSE 'Pediu para não ser contatado.' END,op_token=NULL,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_person;
 PERFORM app.linkedin_release_slot(p_ws,p_person);
 RETURN false;
END $$;
CREATE OR REPLACE FUNCTION app.finish_linkedin_invite(p_ws text,p_person text,p_token text,p_outcome text,p_reason text,p_invitation text,p_hold_until timestamptz,p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.linkedin_campaign_person;
BEGIN
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND id=p_person AND op_token=p_token AND state='sending' FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF p_outcome IN('skipped','held') THEN
  DELETE FROM app.linkedin_invite_operation WHERE workspace_id=p_ws AND person_id=p_person AND state='sending';
  PERFORM app.linkedin_release_slot(p_ws,p_person);
  IF p_outcome='held' THEN UPDATE app.linkedin_account a SET invite_hold_until=p_hold_until FROM app.linkedin_campaign c WHERE c.workspace_id=p_ws AND c.id=p.campaign_id AND a.workspace_id=p_ws AND a.id=c.account_id;END IF;
 ELSE
  UPDATE app.linkedin_invite_operation SET state=CASE p_outcome WHEN 'sent' THEN 'sent' WHEN 'uncertain' THEN 'uncertain' ELSE 'failed' END WHERE workspace_id=p_ws AND person_id=p_person AND state='sending';
 END IF;
 UPDATE app.linkedin_campaign_person SET state=CASE WHEN p_outcome='held' AND opted_out_at IS NOT NULL THEN 'skipped' WHEN p_outcome='sent' THEN 'invited' WHEN p_outcome='held' THEN 'queued' ELSE p_outcome END,op_token=NULL,reason=left(p_reason,300),
  invitation_id=p_invitation,invited_at=CASE WHEN p_outcome IN('sent','uncertain') THEN p_now END,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_person;
 IF p_outcome IN('sent','uncertain') THEN
  INSERT INTO app.linkedin_campaign_event(workspace_id,campaign_id,person_id,kind,at) VALUES(p_ws,p.campaign_id,p_person,CASE WHEN p_outcome='sent' THEN 'invited' ELSE 'uncertain' END,p_now) ON CONFLICT DO NOTHING;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION app.opt_out_linkedin_person(p_person text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);ext text;
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 SELECT external_id INTO ext FROM app.linkedin_campaign_person WHERE workspace_id=ws AND id=p_person;
 IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_PERSON_NOT_FOUND';END IF;
 UPDATE app.linkedin_campaign_person SET opted_out_at=coalesce(opted_out_at,clock_timestamp()),opted_out_by=coalesce(opted_out_by,current_setting('app.user_id',true)),
  state=CASE WHEN state='queued' THEN 'skipped' ELSE state END,reason=CASE WHEN state='queued' THEN 'Pediu para não ser contatado.' ELSE reason END,updated_at=clock_timestamp()
  WHERE workspace_id=ws AND external_id=ext;
END $$;
CREATE OR REPLACE FUNCTION app.claim_linkedin_reply(p_thread text,p_token_hash text,p_body_hash text,p_request text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.linkedin_reply;p app.linkedin_campaign_person;a app.linkedin_account;chat text;
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 SELECT * INTO r FROM app.linkedin_reply WHERE workspace_id=ws AND request_id=p_request;
 IF FOUND THEN
  IF r.thread_id<>p_thread OR r.token_hash<>p_token_hash THEN RAISE EXCEPTION 'LINKEDIN_REPLY_USED';END IF;
  RETURN jsonb_build_object('replay',true,'state',r.state);
 END IF;
 SELECT * INTO r FROM app.linkedin_reply WHERE workspace_id=ws AND token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND OR r.thread_id<>p_thread OR r.user_id<>current_setting('app.user_id',true) THEN RAISE EXCEPTION 'LINKEDIN_REPLY_INVALID';END IF;
 IF r.state<>'prepared' THEN RAISE EXCEPTION 'LINKEDIN_REPLY_USED';END IF;
 IF r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'LINKEDIN_REPLY_EXPIRED';END IF;
 IF r.body_hash<>p_body_hash THEN RAISE EXCEPTION 'LINKEDIN_REPLY_CHANGED';END IF;
 SELECT p2.* INTO p FROM app.linkedin_thread t JOIN app.linkedin_campaign_person p2 ON p2.workspace_id=t.workspace_id AND p2.id=t.person_id WHERE t.workspace_id=ws AND t.id=p_thread FOR SHARE OF p2;
 IF p.opted_out_at IS NOT NULL THEN RAISE EXCEPTION 'LINKEDIN_OPTED_OUT';END IF;
 a:=app.linkedin_thread_account(ws,p_thread);
 IF a.state IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_NOT_READY';END IF;
 SELECT remote_chat_id INTO chat FROM app.linkedin_thread WHERE workspace_id=ws AND id=p_thread;
 UPDATE app.linkedin_reply SET state='sending',request_id=p_request,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=r.id;
 RETURN jsonb_build_object('replay',false,'replyId',r.id,'chat',chat,'external',a.external_account_id,'capabilitiesVersion',a.capabilities_version);
END $$;
CREATE OR REPLACE FUNCTION app.finish_linkedin_reply(p_reply text,p_outcome text,p_remote text,p_body text,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.linkedin_reply;
BEGIN
 SELECT * INTO r FROM app.linkedin_reply WHERE workspace_id=ws AND id=p_reply AND state='sending' AND user_id=current_setting('app.user_id',true) FOR UPDATE;
 IF NOT FOUND OR p_outcome NOT IN('sent','uncertain','failed') THEN RETURN;END IF;
 UPDATE app.linkedin_reply SET state=p_outcome,remote_id=p_remote,error=left(p_error,300),updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_reply;
 IF p_outcome='sent' THEN
  INSERT INTO app.linkedin_message(workspace_id,id,thread_id,remote_id,direction,body,sent_at,origin)
   VALUES(ws,gen_random_uuid()::text,r.thread_id,coalesce(p_remote,'reply:'||r.id),'out',left(p_body,8000),clock_timestamp(),'reply') ON CONFLICT DO NOTHING;
  UPDATE app.linkedin_thread SET last_message_at=greatest(last_message_at,clock_timestamp()) WHERE workspace_id=ws AND id=r.thread_id;
 END IF;
END $$;
DROP FUNCTION app.claim_linkedin_messages(timestamptz,integer,text);
CREATE FUNCTION app.claim_linkedin_messages(p_now timestamptz,p_limit integer,p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE out jsonb;
BEGIN
 WITH due AS(SELECT la.workspace_id,la.id FROM app.linkedin_account la WHERE la.state='ready'
   AND (la.messages_checked_at IS NULL OR la.messages_checked_at<=p_now-interval '15 minutes') AND (la.messages_lease_until IS NULL OR la.messages_lease_until<=clock_timestamp())
   AND EXISTS(SELECT 1 FROM app.linkedin_campaign c JOIN app.linkedin_campaign_person p ON p.workspace_id=c.workspace_id AND p.campaign_id=c.id
    WHERE c.workspace_id=la.workspace_id AND c.account_id=la.id AND p.state IN('invited','uncertain','accepted'))
   ORDER BY la.messages_checked_at NULLS FIRST LIMIT least(greatest(p_limit,1),20) FOR UPDATE OF la SKIP LOCKED),
  leased AS(UPDATE app.linkedin_account la SET messages_token=p_token,messages_lease_until=clock_timestamp()+interval '120 seconds',messages_checked_at=p_now FROM due
   WHERE la.workspace_id=due.workspace_id AND la.id=due.id RETURNING la.*)
 SELECT coalesce(jsonb_agg(jsonb_build_object('workspaceId',workspace_id,'accountId',id,'external',external_account_id,'memberId',external_member_id,
  'after',coalesce(messages_after,p_now-interval '7 days'),'pageCursor',messages_page_cursor,'capabilitiesVersion',capabilities_version)),'[]') INTO out FROM leased;
 RETURN out;
END $$;
DROP FUNCTION app.finish_linkedin_messages(text,text,text,jsonb,timestamptz);
CREATE FUNCTION app.finish_linkedin_messages(p_ws text,p_account text,p_token text,p_items jsonb,p_newest timestamptz,p_cursor text,p_failed boolean) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.linkedin_account;i jsonb;t app.linkedin_thread;pid text;n integer:=0;added integer;who text;
BEGIN
 SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=p_ws AND id=p_account AND messages_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN 0;END IF;
 FOR i IN SELECT * FROM jsonb_array_elements(coalesce(p_items,'[]')) LOOP
  SELECT * INTO t FROM app.linkedin_thread WHERE workspace_id=p_ws AND member_id=a.external_member_id AND remote_chat_id=i->>'chat';
  who:=coalesce(t.attendee_id,i->>'attendee');
  -- Unknown chat, or a cached one whose attendee may have joined a campaign since: match the person again.
  IF NOT FOUND OR t.person_id IS NULL THEN
   CONTINUE WHEN who IS NULL;
   pid:=NULL;
   SELECT p.id INTO pid FROM app.linkedin_campaign_person p JOIN app.linkedin_campaign c ON c.workspace_id=p.workspace_id AND c.id=p.campaign_id
    JOIN app.linkedin_account x ON x.workspace_id=c.workspace_id AND x.id=c.account_id
    WHERE p.workspace_id=p_ws AND x.external_member_id=a.external_member_id AND p.external_id=who AND p.state IN('invited','uncertain','accepted')
    ORDER BY (p.state='accepted') DESC,p.created_at LIMIT 1;
   INSERT INTO app.linkedin_thread(workspace_id,id,member_id,remote_chat_id,person_id,attendee_id) VALUES(p_ws,gen_random_uuid()::text,a.external_member_id,i->>'chat',pid,who)
    ON CONFLICT(workspace_id,member_id,remote_chat_id) DO UPDATE SET person_id=coalesce(app.linkedin_thread.person_id,EXCLUDED.person_id),attendee_id=coalesce(app.linkedin_thread.attendee_id,EXCLUDED.attendee_id);
   SELECT * INTO t FROM app.linkedin_thread WHERE workspace_id=p_ws AND member_id=a.external_member_id AND remote_chat_id=i->>'chat';
  END IF;
  CONTINUE WHEN t.person_id IS NULL;
  INSERT INTO app.linkedin_message(workspace_id,id,thread_id,remote_id,direction,body,sent_at,origin)
   VALUES(p_ws,gen_random_uuid()::text,t.id,i->>'remoteId',CASE WHEN i->>'direction'='out' THEN 'out' ELSE 'in' END,left(coalesce(i->>'body',''),8000),(i->>'sentAt')::timestamptz,'synced')
   ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS added=ROW_COUNT;CONTINUE WHEN added=0;n:=n+1;
  UPDATE app.linkedin_thread SET last_message_at=greatest(last_message_at,(i->>'sentAt')::timestamptz) WHERE workspace_id=p_ws AND id=t.id;
  -- Only what arrived after the invite answers the campaign; older messages stay as history.
  IF i->>'direction'='in' THEN UPDATE app.linkedin_campaign_person SET replied_at=coalesce(replied_at,(i->>'sentAt')::timestamptz),updated_at=clock_timestamp()
   WHERE workspace_id=p_ws AND id=t.person_id AND invited_at IS NOT NULL AND (i->>'sentAt')::timestamptz>=invited_at;END IF;
 END LOOP;
 IF p_failed THEN UPDATE app.linkedin_account SET messages_token=NULL,messages_lease_until=NULL WHERE workspace_id=p_ws AND id=p_account;
 ELSIF p_cursor IS NULL THEN
  UPDATE app.linkedin_account SET messages_after=greatest(messages_after,messages_pending_newest,p_newest),messages_page_cursor=NULL,messages_pending_newest=NULL,
   messages_token=NULL,messages_lease_until=NULL WHERE workspace_id=p_ws AND id=p_account;
 ELSE
  UPDATE app.linkedin_account SET messages_page_cursor=left(p_cursor,2000),messages_pending_newest=greatest(messages_pending_newest,p_newest),messages_token=NULL,messages_lease_until=NULL
   WHERE workspace_id=p_ws AND id=p_account;
 END IF;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION app.claim_linkedin_messages(timestamptz,integer,text),app.finish_linkedin_messages(text,text,text,jsonb,timestamptz,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_linkedin_messages(timestamptz,integer,text),app.finish_linkedin_messages(text,text,text,jsonb,timestamptz,text,boolean) TO cadence_worker;
