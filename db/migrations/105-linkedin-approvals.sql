-- 07A.3c: a sequence step may comment on the person's latest post. The AI writes the comment, which waits here until an
-- owner, admin or operator approves it (possibly edited): the only public action of the module never goes out on its own.
CREATE TABLE app.linkedin_approval(
 workspace_id text NOT NULL,id text NOT NULL,run_id text NOT NULL,step_index integer NOT NULL,person_id text NOT NULL,campaign_id text NOT NULL,
 post_social_id text NOT NULL CHECK(length(post_social_id) BETWEEN 1 AND 300),post_text text NOT NULL CHECK(length(post_text)<=3000),post_url text CHECK(length(post_url)<=1000),post_date timestamptz,
 ai_body text NOT NULL CHECK(length(ai_body) BETWEEN 1 AND 1250),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 1250),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','posting','posted','uncertain','failed','rejected','expired','cancelled')),
 revision bigint NOT NULL DEFAULT 1,request_id text,decided_by text,decided_at timestamptz,remote_comment_id text,
 ai_provider text,ai_input_tokens integer,ai_output_tokens integer,
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,run_id,step_index),
 FOREIGN KEY(workspace_id,run_id) REFERENCES app.linkedin_sequence_run(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,person_id) REFERENCES app.linkedin_campaign_person(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX linkedin_approval_open ON app.linkedin_approval(expires_at) WHERE state IN('pending','posting');
ALTER TABLE app.linkedin_approval ENABLE ROW LEVEL SECURITY;ALTER TABLE app.linkedin_approval FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.linkedin_approval FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing;
CREATE POLICY tenant_read ON app.linkedin_approval FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT(workspace_id,id,run_id,step_index,person_id,campaign_id,post_text,post_url,post_date,ai_body,body,state,revision,decided_at,created_at,expires_at,updated_at) ON app.linkedin_approval TO cadence_app;

-- A step that leaves a run (approved, rejected, expired, skipped) moves it on, unless it stopped meanwhile.
CREATE FUNCTION app.linkedin_comment_done(p_ws text,p_run text,p_step integer,p_send text,p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.linkedin_sequence_send SET state=p_send WHERE workspace_id=p_ws AND run_id=p_run AND step_index=p_step;
 IF EXISTS(SELECT 1 FROM app.linkedin_sequence_run WHERE workspace_id=p_ws AND id=p_run AND step_index=p_step AND state IN('active','waiting')) THEN
  PERFORM app.linkedin_sequence_advance(p_ws,p_run,p_now);END IF;
END $$;
-- Worker sweep: pending past 7 days expire, pending of stopped runs are cancelled, a publish left mid-call is uncertain.
CREATE FUNCTION app.linkedin_approval_sweep(p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record;
BEGIN
 UPDATE app.linkedin_approval a SET state='cancelled',revision=revision+1,updated_at=clock_timestamp() FROM app.linkedin_sequence_run x
  WHERE a.workspace_id=x.workspace_id AND a.run_id=x.id AND a.state='pending' AND x.state='stopped';
 FOR r IN UPDATE app.linkedin_approval SET state='expired',revision=revision+1,updated_at=clock_timestamp() WHERE state='pending' AND expires_at<=p_now RETURNING workspace_id,run_id,step_index LOOP
  PERFORM app.linkedin_comment_done(r.workspace_id,r.run_id,r.step_index,'done',p_now);END LOOP;
 FOR r IN UPDATE app.linkedin_approval SET state='uncertain',updated_at=clock_timestamp() WHERE state='posting' AND updated_at<clock_timestamp()-interval '5 minutes' RETURNING workspace_id,run_id,step_index LOOP
  PERFORM app.linkedin_comment_done(r.workspace_id,r.run_id,r.step_index,'uncertain',p_now);END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app.claim_linkedin_sequence_step(p_token text,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE acc record;a app.linkedin_account;r record;d date:=(p_now AT TIME ZONE 'America/Sao_Paulo')::date;used integer;chat text;
BEGIN
 INSERT INTO app.linkedin_sequence_run(workspace_id,id,sequence_id,person_id,next_at)
  SELECT q.workspace_id,gen_random_uuid()::text,q.id,p.id,greatest(p.accepted_at+make_interval(days=>(q.steps->0->>'delayDays')::int),p_now)
  FROM app.linkedin_sequence q JOIN app.linkedin_campaign_person p ON p.workspace_id=q.workspace_id AND p.campaign_id=q.campaign_id
  JOIN app.linkedin_campaign c ON c.workspace_id=q.workspace_id AND c.id=q.campaign_id
  WHERE q.state='active' AND c.state IN('active','paused') AND p.state='accepted' AND p.accepted_at IS NOT NULL AND p.replied_at IS NULL AND p.stage_override IS DISTINCT FROM 'replied' AND p.opted_out_at IS NULL
  ON CONFLICT(workspace_id,sequence_id,person_id) DO NOTHING;
 WITH stale AS(UPDATE app.linkedin_sequence_send s SET state='uncertain' FROM app.linkedin_sequence_run x
   WHERE s.workspace_id=x.workspace_id AND s.run_id=x.id AND s.state='sending' AND x.lease_until<clock_timestamp()-interval '5 minutes' RETURNING s.workspace_id,s.run_id)
 UPDATE app.linkedin_sequence_run x SET state='stopped',reason='uncertain',lease_token=NULL,updated_at=clock_timestamp() FROM stale WHERE x.workspace_id=stale.workspace_id AND x.id=stale.run_id;
 UPDATE app.linkedin_sequence_run x SET state='stopped',lease_token=NULL,draft_body=NULL,updated_at=clock_timestamp(),
  reason=CASE WHEN p.opted_out_at IS NOT NULL THEN 'opted_out' WHEN (p.replied_at IS NOT NULL OR p.stage_override='replied') THEN 'replied' WHEN q.state='archived' THEN 'archived' ELSE 'campaign_ended' END
  FROM app.linkedin_campaign_person p,app.linkedin_sequence q,app.linkedin_campaign c
  WHERE p.workspace_id=x.workspace_id AND p.id=x.person_id AND q.workspace_id=x.workspace_id AND q.id=x.sequence_id AND c.workspace_id=q.workspace_id AND c.id=q.campaign_id
   AND x.state IN('active','waiting') AND (x.lease_token IS NULL OR x.lease_until<clock_timestamp())
   AND (p.opted_out_at IS NOT NULL OR (p.replied_at IS NOT NULL OR p.stage_override='replied') OR q.state='archived' OR c.state IN('completed','cancelled'));
 PERFORM app.linkedin_approval_sweep(p_now);
 FOR acc IN SELECT DISTINCT la.workspace_id,la.id,la.external_member_id FROM app.linkedin_sequence_run x JOIN app.linkedin_sequence q ON q.workspace_id=x.workspace_id AND q.id=x.sequence_id
   JOIN app.linkedin_campaign c ON c.workspace_id=q.workspace_id AND c.id=q.campaign_id JOIN app.linkedin_account la ON la.workspace_id=c.workspace_id AND la.id=c.account_id
   WHERE x.state='active' AND x.next_at<=p_now AND q.state='active' AND c.state='active' AND la.state='ready' ORDER BY la.external_member_id,la.workspace_id,la.id LOOP
  CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('linkedin-sequence:'||acc.external_member_id,0));
  SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=acc.workspace_id AND id=acc.id FOR UPDATE;
  CONTINUE WHEN a.state<>'ready' OR a.seq_last_at>p_now-interval '5 minutes';
  SELECT count(*) INTO used FROM app.linkedin_sequence_send WHERE member_id=a.external_member_id AND day=d AND state IN('sending','sent','uncertain');
  CONTINUE WHEN used>=30;
  SELECT x.*,q.steps,c.draft cdraft,p.name,p.company,p.headline,p.industry,p.external_id INTO r FROM app.linkedin_sequence_run x JOIN app.linkedin_sequence q ON q.workspace_id=x.workspace_id AND q.id=x.sequence_id
   JOIN app.linkedin_campaign c ON c.workspace_id=q.workspace_id AND c.id=q.campaign_id JOIN app.linkedin_campaign_person p ON p.workspace_id=x.workspace_id AND p.id=x.person_id
   WHERE x.workspace_id=a.workspace_id AND c.account_id=a.id AND x.state='active' AND x.next_at<=p_now AND q.state='active' AND c.state='active' AND p.replied_at IS NULL AND p.stage_override IS DISTINCT FROM 'replied' AND p.opted_out_at IS NULL
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
  RETURN jsonb_build_object('workspaceId',r.workspace_id,'runId',r.id,'stepIndex',r.step_index,'body',r.steps->r.step_index->>'body','kind',coalesce(r.steps->r.step_index->>'kind','message'),'guidance',r.steps->r.step_index->>'guidance','name',r.name,'company',r.company,'headline',r.headline,
   'industry',r.industry,'proof',r.cdraft->>'proof','attendee',r.external_id,'chat',chat,'external',a.external_account_id,'epoch',a.credential_epoch,'capabilitiesVersion',a.capabilities_version);
 END LOOP;
 RETURN NULL;
END $$;

-- Worker, after the AI drafted the comment (p_post set) or found no post to comment on (p_post null: the step is skipped).
CREATE FUNCTION app.finish_linkedin_sequence_comment(p_ws text,p_run text,p_token text,p_post jsonb,p_body text,p_usage jsonb,p_reason text,p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x app.linkedin_sequence_run;p app.linkedin_campaign_person;
BEGIN
 SELECT * INTO x FROM app.linkedin_sequence_run WHERE workspace_id=p_ws AND id=p_run AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 PERFORM app.linkedin_sequence_release(p_ws,p_run);
 IF p_post IS NULL THEN
  UPDATE app.linkedin_sequence_send SET state='done' WHERE workspace_id=p_ws AND run_id=p_run AND step_index=x.step_index;
  PERFORM app.linkedin_sequence_advance(p_ws,p_run,p_now);RETURN;
 END IF;
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND id=x.person_id;
 INSERT INTO app.linkedin_approval(workspace_id,id,run_id,step_index,person_id,campaign_id,post_social_id,post_text,post_url,post_date,ai_body,body,ai_provider,ai_input_tokens,ai_output_tokens,created_at,expires_at)
  VALUES(p_ws,gen_random_uuid()::text,p_run,x.step_index,x.person_id,p.campaign_id,left(p_post->>'socialId',300),left(coalesce(p_post->>'text',''),3000),left(p_post->>'url',1000),(p_post->>'date')::timestamptz,
   left(p_body,1250),left(p_body,1250),left(p_usage->>'provider',60),(p_usage->>'inputTokens')::integer,(p_usage->>'outputTokens')::integer,p_now,p_now+interval '7 days')
  ON CONFLICT(workspace_id,run_id,step_index) DO NOTHING;
 UPDATE app.linkedin_sequence_send SET state='drafted' WHERE workspace_id=p_ws AND run_id=p_run AND step_index=x.step_index;
 UPDATE app.linkedin_sequence_run SET state='waiting',draft_body=NULL,next_at=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_run;
END $$;

-- App: owner, admin or operator approves the (possibly edited) text. The same request returns what it did.
CREATE FUNCTION app.claim_linkedin_comment(p_id text,p_expected bigint,p_body text,p_request text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.linkedin_approval;p app.linkedin_campaign_person;la app.linkedin_account;
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 SELECT * INTO a FROM app.linkedin_approval WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_APPROVAL_NOT_FOUND';END IF;
 IF a.request_id=p_request THEN RETURN jsonb_build_object('replay',true,'state',a.state);END IF;
 IF a.state<>'pending' THEN RAISE EXCEPTION 'LINKEDIN_APPROVAL_CLOSED';END IF;
 IF a.revision<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=ws AND id=a.person_id FOR SHARE;
 IF p.opted_out_at IS NOT NULL THEN RAISE EXCEPTION 'LINKEDIN_OPTED_OUT';END IF;
 SELECT l.* INTO la FROM app.linkedin_campaign c JOIN app.linkedin_account l ON l.workspace_id=c.workspace_id AND l.id=c.account_id WHERE c.workspace_id=ws AND c.id=a.campaign_id;
 IF la.state IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_NOT_READY';END IF;
 UPDATE app.linkedin_approval SET state='posting',body=left(p_body,1250),request_id=p_request,decided_by=current_setting('app.user_id',true),decided_at=clock_timestamp(),
  revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id;
 RETURN jsonb_build_object('replay',false,'socialId',a.post_social_id,'external',la.external_account_id,'capabilitiesVersion',la.capabilities_version);
END $$;
CREATE FUNCTION app.finish_linkedin_comment(p_id text,p_request text,p_outcome text,p_remote text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.linkedin_approval;
BEGIN
 IF p_outcome NOT IN('posted','uncertain','failed') THEN RAISE EXCEPTION 'LINKEDIN_APPROVAL_CLOSED';END IF;
 SELECT * INTO a FROM app.linkedin_approval WHERE workspace_id=ws AND id=p_id AND request_id=p_request AND state='posting' AND decided_by=current_setting('app.user_id',true) FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 UPDATE app.linkedin_approval SET state=p_outcome,remote_comment_id=left(p_remote,200),updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id;
 PERFORM app.linkedin_comment_done(ws,a.run_id,a.step_index,CASE WHEN p_outcome='uncertain' THEN 'uncertain' ELSE 'done' END,clock_timestamp());
END $$;
CREATE FUNCTION app.reject_linkedin_comment(p_id text,p_expected bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.linkedin_approval;
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 SELECT * INTO a FROM app.linkedin_approval WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_APPROVAL_NOT_FOUND';END IF;
 IF a.state<>'pending' THEN RAISE EXCEPTION 'LINKEDIN_APPROVAL_CLOSED';END IF;
 IF a.revision<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 UPDATE app.linkedin_approval SET state='rejected',decided_by=current_setting('app.user_id',true),decided_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id;
 PERFORM app.linkedin_comment_done(ws,a.run_id,a.step_index,'done',clock_timestamp());
 RETURN a.revision+1;
END $$;

DO $$ DECLARE f text;BEGIN FOREACH f IN ARRAY ARRAY['app.linkedin_comment_done(text,text,integer,text,timestamptz)','app.linkedin_approval_sweep(timestamptz)',
 'app.finish_linkedin_sequence_comment(text,text,text,jsonb,text,jsonb,text,timestamptz)','app.claim_linkedin_comment(text,bigint,text,text)',
 'app.finish_linkedin_comment(text,text,text,text)','app.reject_linkedin_comment(text,bigint)'] LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC';END LOOP;END $$;
GRANT EXECUTE ON FUNCTION app.claim_linkedin_comment(text,bigint,text,text),app.finish_linkedin_comment(text,text,text,text),app.reject_linkedin_comment(text,bigint) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.finish_linkedin_sequence_comment(text,text,text,jsonb,text,jsonb,text,timestamptz) TO cadence_worker;
