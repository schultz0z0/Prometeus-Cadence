-- 07A.3a: people, pipeline and conversations of LinkedIn campaigns. Only chats with campaign people are kept;
-- remote ids are unique per thread. A reply is reviewed text confirmed by the same user within a minute.
ALTER TABLE app.linkedin_campaign_person ADD COLUMN replied_at timestamptz,ADD COLUMN stage_override text CHECK(stage_override IN('accepted','replied')),
 ADD COLUMN stage_revision bigint NOT NULL DEFAULT 1,ADD COLUMN stage_request text,ADD COLUMN opted_out_at timestamptz,ADD COLUMN opted_out_by text;
GRANT SELECT(replied_at,stage_override,stage_revision,opted_out_at) ON app.linkedin_campaign_person TO cadence_app;
ALTER TABLE app.linkedin_account ADD COLUMN messages_after timestamptz,ADD COLUMN messages_checked_at timestamptz,ADD COLUMN messages_token text,ADD COLUMN messages_lease_until timestamptz;

CREATE TABLE app.linkedin_thread(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,member_id text NOT NULL,remote_chat_id text NOT NULL CHECK(length(remote_chat_id) BETWEEN 1 AND 200),
 person_id text,last_message_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,member_id,remote_chat_id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES app.linkedin_campaign_person(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX linkedin_thread_person ON app.linkedin_thread(workspace_id,person_id);
CREATE TABLE app.linkedin_message(
 workspace_id text NOT NULL,id text NOT NULL,thread_id text NOT NULL,remote_id text NOT NULL CHECK(length(remote_id) BETWEEN 1 AND 200),
 direction text NOT NULL CHECK(direction IN('in','out')),body text NOT NULL CHECK(length(body)<=8000),sent_at timestamptz NOT NULL,
 origin text NOT NULL CHECK(origin IN('synced','reply')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,thread_id,remote_id),
 FOREIGN KEY(workspace_id,thread_id) REFERENCES app.linkedin_thread(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE app.linkedin_reply(
 workspace_id text NOT NULL,id text NOT NULL,thread_id text NOT NULL,user_id text NOT NULL,body_hash text NOT NULL,token_hash text NOT NULL,expires_at timestamptz NOT NULL,
 request_id text,state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','sending','sent','uncertain','failed')),remote_id text,error text CHECK(length(error)<=300),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,request_id),
 FOREIGN KEY(workspace_id,thread_id) REFERENCES app.linkedin_thread(workspace_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX linkedin_reply_token ON app.linkedin_reply(token_hash);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['linkedin_thread','linkedin_message','linkedin_reply'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
END LOOP;END $$;
CREATE POLICY tenant_read ON app.linkedin_thread FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT(workspace_id,id,person_id,last_message_at) ON app.linkedin_thread TO cadence_app;
CREATE POLICY tenant_read ON app.linkedin_message FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT(workspace_id,id,thread_id,direction,body,sent_at) ON app.linkedin_message TO cadence_app;

-- The account a thread's person was invited from must still be ready.
CREATE FUNCTION app.linkedin_thread_account(p_ws text,p_thread text) RETURNS app.linkedin_account
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT a.* FROM app.linkedin_thread t JOIN app.linkedin_campaign_person p ON p.workspace_id=t.workspace_id AND p.id=t.person_id
  JOIN app.linkedin_campaign c ON c.workspace_id=p.workspace_id AND c.id=p.campaign_id JOIN app.linkedin_account a ON a.workspace_id=c.workspace_id AND a.id=c.account_id
  WHERE t.workspace_id=p_ws AND t.id=p_thread
$$;
CREATE FUNCTION app.prepare_linkedin_reply(p_id text,p_thread text,p_body_hash text,p_token_hash text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);p app.linkedin_campaign_person;a app.linkedin_account;v timestamptz:=clock_timestamp()+interval '60 seconds';
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 SELECT p2.* INTO p FROM app.linkedin_thread t JOIN app.linkedin_campaign_person p2 ON p2.workspace_id=t.workspace_id AND p2.id=t.person_id WHERE t.workspace_id=ws AND t.id=p_thread;
 IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_THREAD_NOT_FOUND';END IF;
 IF p.opted_out_at IS NOT NULL THEN RAISE EXCEPTION 'LINKEDIN_OPTED_OUT';END IF;
 a:=app.linkedin_thread_account(ws,p_thread);
 IF a.state IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_NOT_READY';END IF;
 INSERT INTO app.linkedin_reply(workspace_id,id,thread_id,user_id,body_hash,token_hash,expires_at) VALUES(ws,p_id,p_thread,current_setting('app.user_id',true),p_body_hash,p_token_hash,v);
 RETURN v;
END $$;
-- Confirm: the same user, the same text, within the minute; opt-out and account read again. The request id never sends twice.
CREATE FUNCTION app.claim_linkedin_reply(p_thread text,p_token_hash text,p_body_hash text,p_request text) RETURNS jsonb
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
 SELECT p2.* INTO p FROM app.linkedin_thread t JOIN app.linkedin_campaign_person p2 ON p2.workspace_id=t.workspace_id AND p2.id=t.person_id WHERE t.workspace_id=ws AND t.id=p_thread;
 IF p.opted_out_at IS NOT NULL THEN RAISE EXCEPTION 'LINKEDIN_OPTED_OUT';END IF;
 a:=app.linkedin_thread_account(ws,p_thread);
 IF a.state IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_NOT_READY';END IF;
 SELECT remote_chat_id INTO chat FROM app.linkedin_thread WHERE workspace_id=ws AND id=p_thread;
 UPDATE app.linkedin_reply SET state='sending',request_id=p_request,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=r.id;
 RETURN jsonb_build_object('replay',false,'replyId',r.id,'chat',chat,'external',a.external_account_id,'capabilitiesVersion',a.capabilities_version);
END $$;
CREATE FUNCTION app.finish_linkedin_reply(p_reply text,p_outcome text,p_remote text,p_body text,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.linkedin_reply;
BEGIN
 SELECT * INTO r FROM app.linkedin_reply WHERE workspace_id=ws AND id=p_reply AND state='sending' FOR UPDATE;
 IF NOT FOUND OR p_outcome NOT IN('sent','uncertain','failed') THEN RETURN;END IF;
 UPDATE app.linkedin_reply SET state=p_outcome,remote_id=p_remote,error=left(p_error,300),updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_reply;
 IF p_outcome='sent' THEN
  INSERT INTO app.linkedin_message(workspace_id,id,thread_id,remote_id,direction,body,sent_at,origin)
   VALUES(ws,gen_random_uuid()::text,r.thread_id,coalesce(p_remote,'reply:'||r.id),'out',left(p_body,8000),clock_timestamp(),'reply') ON CONFLICT DO NOTHING;
  UPDATE app.linkedin_thread SET last_message_at=greatest(last_message_at,clock_timestamp()) WHERE workspace_id=ws AND id=r.thread_id;
 END IF;
END $$;
-- After the acceptance only; the same request id returns the same result.
CREATE FUNCTION app.move_linkedin_person(p_person text,p_stage text,p_expected bigint,p_request text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);p app.linkedin_campaign_person;
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=ws AND id=p_person FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_PERSON_NOT_FOUND';END IF;
 IF p.stage_request IS NOT DISTINCT FROM p_request THEN
  RETURN jsonb_build_object('stage',CASE WHEN p.replied_at IS NOT NULL OR p.stage_override='replied' THEN 'replied' ELSE 'accepted' END,'revision',p.stage_revision);
 END IF;
 IF p.state<>'accepted' OR p_stage NOT IN('accepted','replied') THEN RAISE EXCEPTION 'LINKEDIN_STAGE_LOCKED';END IF;
 IF p.stage_revision<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 UPDATE app.linkedin_campaign_person SET stage_override=p_stage,stage_revision=stage_revision+1,stage_request=p_request,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_person RETURNING * INTO p;
 RETURN jsonb_build_object('stage',CASE WHEN p.replied_at IS NOT NULL OR p.stage_override='replied' THEN 'replied' ELSE 'accepted' END,'revision',p.stage_revision);
END $$;
CREATE FUNCTION app.opt_out_linkedin_person(p_person text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 UPDATE app.linkedin_campaign_person SET opted_out_at=coalesce(opted_out_at,clock_timestamp()),opted_out_by=coalesce(opted_out_by,current_setting('app.user_id',true)),
  state=CASE WHEN state='queued' THEN 'skipped' ELSE state END,reason=CASE WHEN state='queued' THEN 'Pediu para não ser contatado.' ELSE reason END,updated_at=clock_timestamp()
  WHERE workspace_id=ws AND id=p_person;
 IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_PERSON_NOT_FOUND';END IF;
END $$;

-- Worker: accounts with people in campaigns, every 15 minutes, leased for two minutes.
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
  'after',coalesce(messages_after,p_now-interval '7 days'),'capabilitiesVersion',capabilities_version)),'[]') INTO out FROM leased;
 RETURN out;
END $$;
CREATE FUNCTION app.linkedin_known_chats(p_ws text,p_member text,p_chats text[]) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(array_agg(remote_chat_id),'{}') FROM app.linkedin_thread WHERE workspace_id=p_ws AND member_id=p_member AND remote_chat_id=ANY(p_chats)
$$;
-- Items: {chat, attendee (only for chats not known yet), remoteId, direction, body, sentAt}. A chat whose attendee is not a
-- campaign person is cached with no person and its messages are not kept. An inbound message marks the person as replied.
CREATE FUNCTION app.finish_linkedin_messages(p_ws text,p_account text,p_token text,p_items jsonb,p_after timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.linkedin_account;i jsonb;t app.linkedin_thread;pid text;n integer:=0;added integer;
BEGIN
 SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=p_ws AND id=p_account AND messages_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN 0;END IF;
 FOR i IN SELECT * FROM jsonb_array_elements(coalesce(p_items,'[]')) LOOP
  SELECT * INTO t FROM app.linkedin_thread WHERE workspace_id=p_ws AND member_id=a.external_member_id AND remote_chat_id=i->>'chat';
  IF NOT FOUND THEN
   CONTINUE WHEN i->>'attendee' IS NULL;
   SELECT p.id INTO pid FROM app.linkedin_campaign_person p JOIN app.linkedin_campaign c ON c.workspace_id=p.workspace_id AND c.id=p.campaign_id
    JOIN app.linkedin_account x ON x.workspace_id=c.workspace_id AND x.id=c.account_id
    WHERE p.workspace_id=p_ws AND x.external_member_id=a.external_member_id AND p.external_id=i->>'attendee' AND p.state IN('invited','uncertain','accepted')
    ORDER BY (p.state='accepted') DESC,p.created_at LIMIT 1;
   INSERT INTO app.linkedin_thread(workspace_id,id,member_id,remote_chat_id,person_id) VALUES(p_ws,gen_random_uuid()::text,a.external_member_id,i->>'chat',pid)
    ON CONFLICT(workspace_id,member_id,remote_chat_id) DO NOTHING;
   SELECT * INTO t FROM app.linkedin_thread WHERE workspace_id=p_ws AND member_id=a.external_member_id AND remote_chat_id=i->>'chat';
  END IF;
  CONTINUE WHEN t.person_id IS NULL;
  INSERT INTO app.linkedin_message(workspace_id,id,thread_id,remote_id,direction,body,sent_at,origin)
   VALUES(p_ws,gen_random_uuid()::text,t.id,i->>'remoteId',CASE WHEN i->>'direction'='out' THEN 'out' ELSE 'in' END,left(coalesce(i->>'body',''),8000),(i->>'sentAt')::timestamptz,'synced')
   ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS added=ROW_COUNT;CONTINUE WHEN added=0;n:=n+1;
  UPDATE app.linkedin_thread SET last_message_at=greatest(last_message_at,(i->>'sentAt')::timestamptz) WHERE workspace_id=p_ws AND id=t.id;
  IF i->>'direction'='in' THEN UPDATE app.linkedin_campaign_person SET replied_at=coalesce(replied_at,(i->>'sentAt')::timestamptz),updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=t.person_id;END IF;
 END LOOP;
 UPDATE app.linkedin_account SET messages_after=greatest(coalesce(messages_after,p_after),p_after),messages_token=NULL,messages_lease_until=NULL WHERE workspace_id=p_ws AND id=p_account;
 RETURN n;
END $$;

REVOKE ALL ON FUNCTION app.linkedin_thread_account(text,text),app.prepare_linkedin_reply(text,text,text,text),app.claim_linkedin_reply(text,text,text,text),
 app.finish_linkedin_reply(text,text,text,text,text),app.move_linkedin_person(text,text,bigint,text),app.opt_out_linkedin_person(text),
 app.claim_linkedin_messages(timestamptz,integer,text),app.linkedin_known_chats(text,text,text[]),app.finish_linkedin_messages(text,text,text,jsonb,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.prepare_linkedin_reply(text,text,text,text),app.claim_linkedin_reply(text,text,text,text),app.finish_linkedin_reply(text,text,text,text,text),
 app.move_linkedin_person(text,text,bigint,text),app.opt_out_linkedin_person(text) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.claim_linkedin_messages(timestamptz,integer,text),app.linkedin_known_chats(text,text,text[]),app.finish_linkedin_messages(text,text,text,jsonb,timestamptz) TO cadence_worker;
