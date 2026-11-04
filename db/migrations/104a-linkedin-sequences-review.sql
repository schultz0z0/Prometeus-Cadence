-- 07A.3b review. A paused campaign holds its post-accept sequence and a cancelled one ends it (as completed did); a
-- manual "Respondeu" mark stops it like a synced reply; a failed recheck defers the run 15 minutes instead of retrying
-- it all tick; archiving leaves a run that is mid-send to its worker, so a delivered message is still recorded.
CREATE OR REPLACE FUNCTION app.linkedin_sequence_action(p_id text,p_action text,p_expected bigint) RETURNS bigint
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
  WHERE workspace_id=ws AND sequence_id=p_id AND state IN('active','waiting') AND (lease_token IS NULL OR lease_until<clock_timestamp());END IF;
 RETURN q.revision+1;
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
  RETURN jsonb_build_object('workspaceId',r.workspace_id,'runId',r.id,'stepIndex',r.step_index,'body',r.steps->r.step_index->>'body','name',r.name,'company',r.company,'headline',r.headline,
   'industry',r.industry,'proof',r.cdraft->>'proof','attendee',r.external_id,'chat',chat,'external',a.external_account_id,'epoch',a.credential_epoch,'capabilitiesVersion',a.capabilities_version);
 END LOOP;
 RETURN NULL;
END $$;
DROP FUNCTION app.linkedin_sequence_recheck(text,text,text,bigint,text);
CREATE FUNCTION app.linkedin_sequence_recheck(p_ws text,p_run text,p_token text,p_epoch bigint,p_caps text,p_now timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ok boolean;
BEGIN
 SELECT EXISTS(SELECT 1 FROM app.linkedin_sequence_run x JOIN app.linkedin_sequence q ON q.workspace_id=x.workspace_id AND q.id=x.sequence_id
  JOIN app.linkedin_campaign c ON c.workspace_id=q.workspace_id AND c.id=q.campaign_id JOIN app.linkedin_account a ON a.workspace_id=c.workspace_id AND a.id=c.account_id
  JOIN app.linkedin_campaign_person p ON p.workspace_id=x.workspace_id AND p.id=x.person_id
  WHERE x.workspace_id=p_ws AND x.id=p_run AND x.lease_token=p_token AND x.state='active' AND q.state='active' AND c.state='active' AND p.replied_at IS NULL AND p.stage_override IS DISTINCT FROM 'replied' AND p.opted_out_at IS NULL
   AND a.state='ready' AND a.credential_epoch=p_epoch AND p_caps IS NOT NULL AND a.capabilities_version=p_caps) INTO ok;
 IF ok THEN RETURN true;END IF;
 DELETE FROM app.linkedin_sequence_send WHERE workspace_id=p_ws AND run_id=p_run AND state='sending';
 PERFORM app.linkedin_sequence_release(p_ws,p_run);
 -- Back in 15 minutes: retried at once it would be claimed first again and starve the other members' steps.
 UPDATE app.linkedin_sequence_run SET lease_token=NULL,lease_until=NULL,next_at=p_now+interval '15 minutes' WHERE workspace_id=p_ws AND id=p_run AND lease_token=p_token;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION app.linkedin_sequence_recheck(text,text,text,bigint,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.linkedin_sequence_recheck(text,text,text,bigint,text,timestamptz) TO cadence_worker;
