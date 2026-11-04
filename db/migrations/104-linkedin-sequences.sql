-- 07A.3b: LinkedIn templates and the post-accept sequence of a campaign. A step is sent once (one ledger row per run and
-- step); automatic mode sends within caps, assisted mode leaves a draft a person reviews and sends (07A.3a reply).
ALTER TABLE app.linkedin_account ADD COLUMN seq_last_at timestamptz,ADD COLUMN seq_prev_at timestamptz;
ALTER TABLE app.linkedin_reply ALTER COLUMN thread_id DROP NOT NULL,ADD COLUMN person_id text;

CREATE TABLE app.linkedin_template(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 kind text NOT NULL CHECK(kind IN('invite','message')),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 8000 AND (kind<>'invite' OR length(body)<=300)),
 revision bigint NOT NULL DEFAULT 1,archived_at timestamptz,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE app.linkedin_sequence(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),campaign_id text NOT NULL,steps jsonb NOT NULL,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','active','paused','archived')),revision bigint NOT NULL DEFAULT 1,
 created_by text NOT NULL,activated_by text,activated_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,campaign_id) REFERENCES app.linkedin_campaign(workspace_id,id)
);
CREATE UNIQUE INDEX linkedin_sequence_live ON app.linkedin_sequence(workspace_id,campaign_id) WHERE state IN('active','paused');
CREATE TABLE app.linkedin_sequence_run(
 workspace_id text NOT NULL,id text NOT NULL,sequence_id text NOT NULL,person_id text NOT NULL,step_index integer NOT NULL DEFAULT 0,next_at timestamptz,
 state text NOT NULL DEFAULT 'active' CHECK(state IN('active','waiting','done','stopped')),reason text,draft_body text CHECK(length(draft_body)<=8000),
 lease_token text,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,sequence_id,person_id),
 FOREIGN KEY(workspace_id,sequence_id) REFERENCES app.linkedin_sequence(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,person_id) REFERENCES app.linkedin_campaign_person(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX linkedin_sequence_due ON app.linkedin_sequence_run(next_at) WHERE state='active';
CREATE TABLE app.linkedin_sequence_send(
 workspace_id text NOT NULL,run_id text NOT NULL,step_index integer NOT NULL,state text NOT NULL CHECK(state IN('sending','sent','uncertain','failed','drafted','done')),
 body text CHECK(length(body)<=8000),remote_id text,member_id text NOT NULL,day date NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,run_id,step_index),FOREIGN KEY(workspace_id,run_id) REFERENCES app.linkedin_sequence_run(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX linkedin_sequence_send_day ON app.linkedin_sequence_send(member_id,day);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['linkedin_template','linkedin_sequence','linkedin_sequence_run','linkedin_sequence_send'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
END LOOP;END $$;
CREATE POLICY tenant_read ON app.linkedin_template FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT(workspace_id,id,name,kind,body,revision,archived_at,updated_at) ON app.linkedin_template TO cadence_app;
CREATE POLICY tenant_read ON app.linkedin_sequence FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT(workspace_id,id,name,campaign_id,steps,state,revision,activated_at,updated_at) ON app.linkedin_sequence TO cadence_app;
CREATE POLICY tenant_read ON app.linkedin_sequence_run FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT(workspace_id,id,sequence_id,person_id,step_index,next_at,state,reason,draft_body,updated_at) ON app.linkedin_sequence_run TO cadence_app;

CREATE FUNCTION app.save_linkedin_template(p_id text,p_name text,p_kind text,p_body text,p_expected bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.linkedin_template;
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 SELECT * INTO t FROM app.linkedin_template WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN
  IF p_expected<>0 THEN RAISE EXCEPTION 'LINKEDIN_TEMPLATE_NOT_FOUND';END IF;
  INSERT INTO app.linkedin_template(workspace_id,id,name,kind,body,created_by) VALUES(ws,p_id,p_name,p_kind,p_body,current_setting('app.user_id',true));RETURN 1;
 END IF;
 IF t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'LINKEDIN_TEMPLATE_NOT_FOUND';END IF;
 IF t.revision<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 UPDATE app.linkedin_template SET name=p_name,kind=p_kind,body=p_body,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id;
 RETURN t.revision+1;
END $$;
CREATE FUNCTION app.archive_linkedin_template(p_id text,p_expected bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);t app.linkedin_template;
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 SELECT * INTO t FROM app.linkedin_template WHERE workspace_id=ws AND id=p_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_TEMPLATE_NOT_FOUND';END IF;
 IF t.revision<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 UPDATE app.linkedin_template SET archived_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id;
END $$;
CREATE FUNCTION app.save_linkedin_sequence(p_id text,p_name text,p_campaign text,p_steps jsonb,p_expected bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);q app.linkedin_sequence;
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 IF NOT EXISTS(SELECT 1 FROM app.linkedin_campaign WHERE workspace_id=ws AND id=p_campaign) THEN RAISE EXCEPTION 'LINKEDIN_CAMPAIGN_NOT_FOUND';END IF;
 SELECT * INTO q FROM app.linkedin_sequence WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN
  IF p_expected<>0 THEN RAISE EXCEPTION 'LINKEDIN_SEQUENCE_NOT_FOUND';END IF;
  INSERT INTO app.linkedin_sequence(workspace_id,id,name,campaign_id,steps,created_by) VALUES(ws,p_id,p_name,p_campaign,p_steps,current_setting('app.user_id',true));RETURN 1;
 END IF;
 IF q.revision<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 IF q.state<>'draft' THEN RAISE EXCEPTION 'LINKEDIN_SEQUENCE_LOCKED';END IF;
 UPDATE app.linkedin_sequence SET name=p_name,campaign_id=p_campaign,steps=p_steps,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id;
 RETURN q.revision+1;
END $$;
-- Owner/admin. One live sequence per campaign; archiving stops every run.
CREATE FUNCTION app.linkedin_sequence_action(p_id text,p_action text,p_expected bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);q app.linkedin_sequence;next text;
BEGIN
 SELECT * INTO q FROM app.linkedin_sequence WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_SEQUENCE_NOT_FOUND';END IF;
 PERFORM app.linkedin_campaign_actor(true);
 IF q.revision<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 next:=CASE WHEN p_action='activate' AND q.state='draft' THEN 'active' WHEN p_action='pause' AND q.state='active' THEN 'paused'
  WHEN p_action='resume' AND q.state='paused' THEN 'active' WHEN p_action='archive' AND q.state<>'archived' THEN 'archived' END;
 IF next IS NULL THEN RAISE EXCEPTION 'LINKEDIN_SEQUENCE_LOCKED';END IF;
 BEGIN
  UPDATE app.linkedin_sequence SET state=next,revision=revision+1,updated_at=clock_timestamp(),
   activated_by=CASE WHEN p_action='activate' THEN current_setting('app.user_id',true) ELSE activated_by END,activated_at=CASE WHEN p_action='activate' THEN clock_timestamp() ELSE activated_at END
   WHERE workspace_id=ws AND id=p_id;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'LINKEDIN_SEQUENCE_EXISTS';
 END;
 IF next='archived' THEN UPDATE app.linkedin_sequence_run SET state='stopped',reason='archived',draft_body=NULL,lease_token=NULL,updated_at=clock_timestamp()
  WHERE workspace_id=ws AND sequence_id=p_id AND state IN('active','waiting');END IF;
 RETURN q.revision+1;
END $$;

-- Worker. Enrols accepted people, stops runs that must stop, then claims one due step per LinkedIn member (try-lock in
-- a fixed order): 5 minutes apart and under 30 sends a Brasília day. Drafts (assisted) do not count.
CREATE FUNCTION app.claim_linkedin_sequence_step(p_token text,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE acc record;a app.linkedin_account;r record;d date:=(p_now AT TIME ZONE 'America/Sao_Paulo')::date;used integer;chat text;
BEGIN
 INSERT INTO app.linkedin_sequence_run(workspace_id,id,sequence_id,person_id,next_at)
  SELECT q.workspace_id,gen_random_uuid()::text,q.id,p.id,greatest(p.accepted_at+make_interval(days=>(q.steps->0->>'delayDays')::int),p_now)
  FROM app.linkedin_sequence q JOIN app.linkedin_campaign_person p ON p.workspace_id=q.workspace_id AND p.campaign_id=q.campaign_id
  WHERE q.state='active' AND p.state='accepted' AND p.accepted_at IS NOT NULL AND p.replied_at IS NULL AND p.opted_out_at IS NULL
  ON CONFLICT(workspace_id,sequence_id,person_id) DO NOTHING;
 WITH stale AS(UPDATE app.linkedin_sequence_send s SET state='uncertain' FROM app.linkedin_sequence_run x
   WHERE s.workspace_id=x.workspace_id AND s.run_id=x.id AND s.state='sending' AND x.lease_until<clock_timestamp()-interval '5 minutes' RETURNING s.workspace_id,s.run_id)
 UPDATE app.linkedin_sequence_run x SET state='stopped',reason='uncertain',lease_token=NULL,updated_at=clock_timestamp() FROM stale WHERE x.workspace_id=stale.workspace_id AND x.id=stale.run_id;
 UPDATE app.linkedin_sequence_run x SET state='stopped',lease_token=NULL,draft_body=NULL,updated_at=clock_timestamp(),
  reason=CASE WHEN p.opted_out_at IS NOT NULL THEN 'opted_out' WHEN p.replied_at IS NOT NULL THEN 'replied' WHEN q.state='archived' THEN 'archived' ELSE 'campaign_ended' END
  FROM app.linkedin_campaign_person p,app.linkedin_sequence q,app.linkedin_campaign c
  WHERE p.workspace_id=x.workspace_id AND p.id=x.person_id AND q.workspace_id=x.workspace_id AND q.id=x.sequence_id AND c.workspace_id=q.workspace_id AND c.id=q.campaign_id
   AND x.state IN('active','waiting') AND (x.lease_token IS NULL OR x.lease_until<clock_timestamp())
   AND (p.opted_out_at IS NOT NULL OR p.replied_at IS NOT NULL OR q.state='archived' OR c.state='completed');
 FOR acc IN SELECT DISTINCT la.workspace_id,la.id,la.external_member_id FROM app.linkedin_sequence_run x JOIN app.linkedin_sequence q ON q.workspace_id=x.workspace_id AND q.id=x.sequence_id
   JOIN app.linkedin_campaign c ON c.workspace_id=q.workspace_id AND c.id=q.campaign_id JOIN app.linkedin_account la ON la.workspace_id=c.workspace_id AND la.id=c.account_id
   WHERE x.state='active' AND x.next_at<=p_now AND q.state='active' AND la.state='ready' ORDER BY la.external_member_id,la.workspace_id,la.id LOOP
  CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('linkedin-sequence:'||acc.external_member_id,0));
  SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=acc.workspace_id AND id=acc.id FOR UPDATE;
  CONTINUE WHEN a.state<>'ready' OR a.seq_last_at>p_now-interval '5 minutes';
  SELECT count(*) INTO used FROM app.linkedin_sequence_send WHERE member_id=a.external_member_id AND day=d AND state IN('sending','sent','uncertain');
  CONTINUE WHEN used>=30;
  SELECT x.*,q.steps,c.draft cdraft,p.name,p.company,p.headline,p.industry,p.external_id INTO r FROM app.linkedin_sequence_run x JOIN app.linkedin_sequence q ON q.workspace_id=x.workspace_id AND q.id=x.sequence_id
   JOIN app.linkedin_campaign c ON c.workspace_id=q.workspace_id AND c.id=q.campaign_id JOIN app.linkedin_campaign_person p ON p.workspace_id=x.workspace_id AND p.id=x.person_id
   WHERE x.workspace_id=a.workspace_id AND c.account_id=a.id AND x.state='active' AND x.next_at<=p_now AND q.state='active' AND p.replied_at IS NULL AND p.opted_out_at IS NULL
    AND (x.lease_until IS NULL OR x.lease_until<clock_timestamp())
   ORDER BY x.next_at,x.id LIMIT 1 FOR UPDATE OF x SKIP LOCKED;
  CONTINUE WHEN NOT FOUND;
  BEGIN
   INSERT INTO app.linkedin_sequence_send(workspace_id,run_id,step_index,state,member_id,day) VALUES(r.workspace_id,r.id,r.step_index,'sending',a.external_member_id,d);
  EXCEPTION WHEN unique_violation THEN
   UPDATE app.linkedin_sequence_run SET state='stopped',reason='uncertain',updated_at=clock_timestamp() WHERE workspace_id=r.workspace_id AND id=r.id;CONTINUE;
  END;
  UPDATE app.linkedin_sequence_run SET lease_token=p_token,lease_until=clock_timestamp()+interval '120 seconds' WHERE workspace_id=r.workspace_id AND id=r.id;
  UPDATE app.linkedin_account SET seq_prev_at=seq_last_at,seq_last_at=p_now WHERE workspace_id=a.workspace_id AND id=a.id;
  SELECT remote_chat_id INTO chat FROM app.linkedin_thread WHERE workspace_id=r.workspace_id AND person_id=r.person_id ORDER BY last_message_at DESC NULLS LAST LIMIT 1;
  RETURN jsonb_build_object('workspaceId',r.workspace_id,'runId',r.id,'stepIndex',r.step_index,'body',r.steps->r.step_index->>'body','name',r.name,'company',r.company,'headline',r.headline,
   'industry',r.industry,'proof',r.cdraft->>'proof','attendee',r.external_id,'chat',chat,'external',a.external_account_id,'epoch',a.credential_epoch,'capabilitiesVersion',a.capabilities_version);
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION app.linkedin_sequence_release(p_ws text,p_run text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE app.linkedin_account a SET seq_last_at=a.seq_prev_at FROM app.linkedin_sequence_run x JOIN app.linkedin_sequence q ON q.workspace_id=x.workspace_id AND q.id=x.sequence_id
  JOIN app.linkedin_campaign c ON c.workspace_id=q.workspace_id AND c.id=q.campaign_id WHERE x.workspace_id=p_ws AND x.id=p_run AND a.workspace_id=c.workspace_id AND a.id=c.account_id
$$;
-- Right before the call: sequence active, person not replied nor opted out, account ready on the same epoch and attestation.
CREATE FUNCTION app.linkedin_sequence_recheck(p_ws text,p_run text,p_token text,p_epoch bigint,p_caps text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ok boolean;
BEGIN
 SELECT EXISTS(SELECT 1 FROM app.linkedin_sequence_run x JOIN app.linkedin_sequence q ON q.workspace_id=x.workspace_id AND q.id=x.sequence_id
  JOIN app.linkedin_campaign c ON c.workspace_id=q.workspace_id AND c.id=q.campaign_id JOIN app.linkedin_account a ON a.workspace_id=c.workspace_id AND a.id=c.account_id
  JOIN app.linkedin_campaign_person p ON p.workspace_id=x.workspace_id AND p.id=x.person_id
  WHERE x.workspace_id=p_ws AND x.id=p_run AND x.lease_token=p_token AND x.state='active' AND q.state='active' AND p.replied_at IS NULL AND p.opted_out_at IS NULL
   AND a.state='ready' AND a.credential_epoch=p_epoch AND p_caps IS NOT NULL AND a.capabilities_version=p_caps) INTO ok;
 IF ok THEN RETURN true;END IF;
 DELETE FROM app.linkedin_sequence_send WHERE workspace_id=p_ws AND run_id=p_run AND state='sending';
 PERFORM app.linkedin_sequence_release(p_ws,p_run);
 UPDATE app.linkedin_sequence_run SET lease_token=NULL,lease_until=NULL WHERE workspace_id=p_ws AND id=p_run AND lease_token=p_token;
 RETURN false;
END $$;
-- The thread of a person's chat (created when a send starts it) and the outbound message, once.
CREATE FUNCTION app.linkedin_record_outbound(p_ws text,p_person text,p_member text,p_chat text,p_remote text,p_body text,p_now timestamptz,p_origin text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tid text;attendee text;
BEGIN
 SELECT external_id INTO attendee FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND id=p_person;
 INSERT INTO app.linkedin_thread(workspace_id,id,member_id,remote_chat_id,person_id,attendee_id,last_message_at) VALUES(p_ws,gen_random_uuid()::text,p_member,p_chat,p_person,attendee,p_now)
  ON CONFLICT(workspace_id,member_id,remote_chat_id) DO UPDATE SET person_id=coalesce(app.linkedin_thread.person_id,EXCLUDED.person_id),last_message_at=greatest(app.linkedin_thread.last_message_at,EXCLUDED.last_message_at)
  RETURNING id INTO tid;
 INSERT INTO app.linkedin_message(workspace_id,id,thread_id,remote_id,direction,body,sent_at,origin) VALUES(p_ws,gen_random_uuid()::text,tid,p_remote,'out',left(p_body,8000),p_now,p_origin) ON CONFLICT DO NOTHING;
 RETURN tid;
END $$;
-- Moves a run past its step: the next step after its days, or done.
CREATE FUNCTION app.linkedin_sequence_advance(p_ws text,p_run text,p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x app.linkedin_sequence_run;steps jsonb;
BEGIN
 SELECT * INTO x FROM app.linkedin_sequence_run WHERE workspace_id=p_ws AND id=p_run;
 SELECT q.steps INTO steps FROM app.linkedin_sequence q WHERE q.workspace_id=p_ws AND q.id=x.sequence_id;
 UPDATE app.linkedin_sequence_run SET step_index=x.step_index+1,draft_body=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp(),
  state=CASE WHEN x.step_index+1<jsonb_array_length(steps) THEN 'active' ELSE 'done' END,
  next_at=CASE WHEN x.step_index+1<jsonb_array_length(steps) THEN p_now+make_interval(days=>(steps->(x.step_index+1)->>'delayDays')::int) END
  WHERE workspace_id=p_ws AND id=p_run;
END $$;
-- sent | drafted (assisted: waits for a person) | stopped (missing fact) | uncertain | failed | held (back later, nothing sent).
CREATE FUNCTION app.finish_linkedin_sequence_step(p_ws text,p_run text,p_token text,p_outcome text,p_body text,p_remote text,p_chat text,p_reason text,p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x app.linkedin_sequence_run;member text;
BEGIN
 SELECT * INTO x FROM app.linkedin_sequence_run WHERE workspace_id=p_ws AND id=p_run AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT member_id INTO member FROM app.linkedin_sequence_send WHERE workspace_id=p_ws AND run_id=p_run AND step_index=x.step_index;
 IF p_outcome='sent' THEN
  UPDATE app.linkedin_sequence_send SET state='sent',body=left(p_body,8000),remote_id=p_remote WHERE workspace_id=p_ws AND run_id=p_run AND step_index=x.step_index;
  IF p_chat IS NOT NULL THEN PERFORM app.linkedin_record_outbound(p_ws,x.person_id,member,p_chat,coalesce(p_remote,'seq:'||p_run||':'||x.step_index),p_body,p_now,'reply');END IF;
  PERFORM app.linkedin_sequence_advance(p_ws,p_run,p_now);
 ELSIF p_outcome='drafted' THEN
  UPDATE app.linkedin_sequence_send SET state='drafted',body=left(p_body,8000) WHERE workspace_id=p_ws AND run_id=p_run AND step_index=x.step_index;
  PERFORM app.linkedin_sequence_release(p_ws,p_run);
  UPDATE app.linkedin_sequence_run SET state='waiting',draft_body=left(p_body,8000),next_at=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_run;
 ELSIF p_outcome IN('stopped','held') THEN
  DELETE FROM app.linkedin_sequence_send WHERE workspace_id=p_ws AND run_id=p_run AND step_index=x.step_index AND state='sending';
  PERFORM app.linkedin_sequence_release(p_ws,p_run);
  UPDATE app.linkedin_sequence_run SET lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp(),
   state=CASE WHEN p_outcome='stopped' THEN 'stopped' ELSE state END,reason=CASE WHEN p_outcome='stopped' THEN left(p_reason,300) ELSE reason END,
   next_at=CASE WHEN p_outcome='held' THEN p_now+interval '1 hour' ELSE next_at END WHERE workspace_id=p_ws AND id=p_run;
 ELSE
  UPDATE app.linkedin_sequence_send SET state=CASE WHEN p_outcome='uncertain' THEN 'uncertain' ELSE 'failed' END,body=left(p_body,8000) WHERE workspace_id=p_ws AND run_id=p_run AND step_index=x.step_index;
  UPDATE app.linkedin_sequence_run SET state='stopped',reason=CASE WHEN p_outcome='uncertain' THEN 'uncertain' ELSE 'failed' END,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_run;
 END IF;
END $$;

-- 07A.3b: a reply may start the chat with a person who has no conversation yet (a 1st-degree relation).
CREATE FUNCTION app.prepare_linkedin_person_reply(p_id text,p_person text,p_body_hash text,p_token_hash text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);p app.linkedin_campaign_person;a app.linkedin_account;tid text;v timestamptz:=clock_timestamp()+interval '60 seconds';
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=ws AND id=p_person;
 IF NOT FOUND OR p.state<>'accepted' THEN RAISE EXCEPTION 'LINKEDIN_PERSON_NOT_FOUND';END IF;
 IF p.opted_out_at IS NOT NULL THEN RAISE EXCEPTION 'LINKEDIN_OPTED_OUT';END IF;
 SELECT la.* INTO a FROM app.linkedin_campaign c JOIN app.linkedin_account la ON la.workspace_id=c.workspace_id AND la.id=c.account_id WHERE c.workspace_id=ws AND c.id=p.campaign_id;
 IF a.state IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_NOT_READY';END IF;
 SELECT id INTO tid FROM app.linkedin_thread WHERE workspace_id=ws AND person_id=p_person ORDER BY last_message_at DESC NULLS LAST LIMIT 1;
 INSERT INTO app.linkedin_reply(workspace_id,id,thread_id,person_id,user_id,body_hash,token_hash,expires_at) VALUES(ws,p_id,tid,p_person,current_setting('app.user_id',true),p_body_hash,p_token_hash,v);
 RETURN v;
END $$;
CREATE FUNCTION app.claim_linkedin_person_reply(p_person text,p_token_hash text,p_body_hash text,p_request text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.linkedin_reply;p app.linkedin_campaign_person;a app.linkedin_account;chat text;
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 SELECT * INTO r FROM app.linkedin_reply WHERE workspace_id=ws AND request_id=p_request;
 IF FOUND THEN
  IF r.person_id IS DISTINCT FROM p_person OR r.token_hash<>p_token_hash THEN RAISE EXCEPTION 'LINKEDIN_REPLY_USED';END IF;
  RETURN jsonb_build_object('replay',true,'state',r.state);
 END IF;
 SELECT * INTO r FROM app.linkedin_reply WHERE workspace_id=ws AND token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND OR r.person_id IS DISTINCT FROM p_person OR r.user_id<>current_setting('app.user_id',true) THEN RAISE EXCEPTION 'LINKEDIN_REPLY_INVALID';END IF;
 IF r.state<>'prepared' THEN RAISE EXCEPTION 'LINKEDIN_REPLY_USED';END IF;
 IF r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'LINKEDIN_REPLY_EXPIRED';END IF;
 IF r.body_hash<>p_body_hash THEN RAISE EXCEPTION 'LINKEDIN_REPLY_CHANGED';END IF;
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=ws AND id=p_person FOR SHARE;
 IF p.opted_out_at IS NOT NULL THEN RAISE EXCEPTION 'LINKEDIN_OPTED_OUT';END IF;
 SELECT la.* INTO a FROM app.linkedin_campaign c JOIN app.linkedin_account la ON la.workspace_id=c.workspace_id AND la.id=c.account_id WHERE c.workspace_id=ws AND c.id=p.campaign_id;
 IF a.state IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_NOT_READY';END IF;
 SELECT remote_chat_id INTO chat FROM app.linkedin_thread WHERE workspace_id=ws AND person_id=p_person ORDER BY last_message_at DESC NULLS LAST LIMIT 1;
 UPDATE app.linkedin_reply SET state='sending',request_id=p_request,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=r.id;
 RETURN jsonb_build_object('replay',false,'replyId',r.id,'chat',chat,'attendee',p.external_id,'external',a.external_account_id,'capabilitiesVersion',a.capabilities_version);
END $$;
-- A reply now records the chat it started, and a person's reviewed send completes the waiting draft of their sequence.
DROP FUNCTION app.finish_linkedin_reply(text,text,text,text,text);
CREATE FUNCTION app.finish_linkedin_reply(p_reply text,p_outcome text,p_remote text,p_body text,p_error text,p_chat text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);r app.linkedin_reply;person text;member text;x app.linkedin_sequence_run;tid text;
BEGIN
 SELECT * INTO r FROM app.linkedin_reply WHERE workspace_id=ws AND id=p_reply AND state='sending' AND user_id=current_setting('app.user_id',true) FOR UPDATE;
 IF NOT FOUND OR p_outcome NOT IN('sent','uncertain','failed') THEN RETURN;END IF;
 UPDATE app.linkedin_reply SET state=p_outcome,remote_id=p_remote,error=left(p_error,300),updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_reply;
 IF p_outcome<>'sent' THEN RETURN;END IF;
 person:=coalesce(r.person_id,(SELECT person_id FROM app.linkedin_thread WHERE workspace_id=ws AND id=r.thread_id));
 IF r.thread_id IS NOT NULL THEN
  INSERT INTO app.linkedin_message(workspace_id,id,thread_id,remote_id,direction,body,sent_at,origin)
   VALUES(ws,gen_random_uuid()::text,r.thread_id,coalesce(p_remote,'reply:'||r.id),'out',left(p_body,8000),clock_timestamp(),'reply') ON CONFLICT DO NOTHING;
  UPDATE app.linkedin_thread SET last_message_at=greatest(last_message_at,clock_timestamp()) WHERE workspace_id=ws AND id=r.thread_id;
 ELSIF p_chat IS NOT NULL THEN
  SELECT la.external_member_id INTO member FROM app.linkedin_campaign_person p JOIN app.linkedin_campaign c ON c.workspace_id=p.workspace_id AND c.id=p.campaign_id
   JOIN app.linkedin_account la ON la.workspace_id=c.workspace_id AND la.id=c.account_id WHERE p.workspace_id=ws AND p.id=person;
  tid:=app.linkedin_record_outbound(ws,person,member,p_chat,coalesce(p_remote,'reply:'||r.id),p_body,clock_timestamp(),'reply');
  UPDATE app.linkedin_reply SET thread_id=tid WHERE workspace_id=ws AND id=p_reply;
 END IF;
 FOR x IN SELECT * FROM app.linkedin_sequence_run WHERE workspace_id=ws AND person_id=person AND state='waiting' FOR UPDATE LOOP
  UPDATE app.linkedin_sequence_send SET state='done' WHERE workspace_id=ws AND run_id=x.id AND step_index=x.step_index AND state='drafted';
  PERFORM app.linkedin_sequence_advance(ws,x.id,clock_timestamp());
 END LOOP;
END $$;

DO $$ DECLARE f text;BEGIN FOREACH f IN ARRAY ARRAY['app.save_linkedin_template(text,text,text,text,bigint)','app.archive_linkedin_template(text,bigint)',
 'app.save_linkedin_sequence(text,text,text,jsonb,bigint)','app.linkedin_sequence_action(text,text,bigint)','app.claim_linkedin_sequence_step(text,timestamptz)',
 'app.linkedin_sequence_release(text,text)','app.linkedin_sequence_recheck(text,text,text,bigint,text)','app.linkedin_record_outbound(text,text,text,text,text,text,timestamptz,text)',
 'app.linkedin_sequence_advance(text,text,timestamptz)','app.finish_linkedin_sequence_step(text,text,text,text,text,text,text,text,timestamptz)',
 'app.prepare_linkedin_person_reply(text,text,text,text)','app.claim_linkedin_person_reply(text,text,text,text)','app.finish_linkedin_reply(text,text,text,text,text,text)'] LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC';END LOOP;END $$;
GRANT EXECUTE ON FUNCTION app.save_linkedin_template(text,text,text,text,bigint),app.archive_linkedin_template(text,bigint),app.save_linkedin_sequence(text,text,text,jsonb,bigint),
 app.linkedin_sequence_action(text,text,bigint),app.prepare_linkedin_person_reply(text,text,text,text),app.claim_linkedin_person_reply(text,text,text,text),
 app.finish_linkedin_reply(text,text,text,text,text,text) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.claim_linkedin_sequence_step(text,timestamptz),app.linkedin_sequence_recheck(text,text,text,bigint,text),
 app.finish_linkedin_sequence_step(text,text,text,text,text,text,text,text,timestamptz) TO cadence_worker;
