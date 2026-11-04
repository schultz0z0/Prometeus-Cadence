-- 07A.3c review. Approving re-checks what the business-hours sweep would close (expired, replied, stopped run, archived
-- or paused sequence, ended or paused campaign); a reply no longer skips a comment waiting for approval; an AI that keeps
-- failing skips the comment step on the third try instead of retrying every hour.
ALTER TABLE app.linkedin_sequence_run ADD COLUMN comment_holds integer NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION app.claim_linkedin_comment(p_id text,p_expected bigint,p_body text,p_request text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.linkedin_approval;p app.linkedin_campaign_person;la app.linkedin_account;live boolean;
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 SELECT * INTO a FROM app.linkedin_approval WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_APPROVAL_NOT_FOUND';END IF;
 IF a.request_id=p_request THEN RETURN jsonb_build_object('replay',true,'state',a.state);END IF;
 IF a.state<>'pending' THEN RAISE EXCEPTION 'LINKEDIN_APPROVAL_CLOSED';END IF;
 IF a.revision<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=ws AND id=a.person_id FOR SHARE;
 IF p.opted_out_at IS NOT NULL THEN RAISE EXCEPTION 'LINKEDIN_OPTED_OUT';END IF;
 -- The worker sweep runs only in business hours: the claim itself refuses what the sweep would close.
 SELECT EXISTS(SELECT 1 FROM app.linkedin_sequence_run x JOIN app.linkedin_sequence q ON q.workspace_id=x.workspace_id AND q.id=x.sequence_id
   JOIN app.linkedin_campaign c ON c.workspace_id=q.workspace_id AND c.id=q.campaign_id
   WHERE x.workspace_id=ws AND x.id=a.run_id AND x.state='waiting' AND x.step_index=a.step_index AND q.state='active' AND c.state='active') INTO live;
 IF NOT live OR a.expires_at<=clock_timestamp() OR p.replied_at IS NOT NULL OR p.stage_override='replied' THEN RAISE EXCEPTION 'LINKEDIN_APPROVAL_CLOSED';END IF;
 SELECT l.* INTO la FROM app.linkedin_campaign c JOIN app.linkedin_account l ON l.workspace_id=c.workspace_id AND l.id=c.account_id WHERE c.workspace_id=ws AND c.id=a.campaign_id;
 IF la.state IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'LINKEDIN_ACCOUNT_NOT_READY';END IF;
 UPDATE app.linkedin_approval SET state='posting',body=left(p_body,1250),request_id=p_request,decided_by=current_setting('app.user_id',true),decided_at=clock_timestamp(),
  revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id;
 RETURN jsonb_build_object('replay',false,'socialId',a.post_social_id,'external',la.external_account_id,'capabilitiesVersion',la.capabilities_version);
END $$;
CREATE OR REPLACE FUNCTION app.finish_linkedin_sequence_comment(p_ws text,p_run text,p_token text,p_post jsonb,p_body text,p_usage jsonb,p_reason text,p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x app.linkedin_sequence_run;p app.linkedin_campaign_person;
BEGIN
 SELECT * INTO x FROM app.linkedin_sequence_run WHERE workspace_id=p_ws AND id=p_run AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 PERFORM app.linkedin_sequence_release(p_ws,p_run);
 -- The AI failed (no route, an error or an invalid comment): back in an hour, and the third failure skips the step.
 IF p_post IS NULL AND p_reason='ai_failed' AND x.comment_holds<2 THEN
  DELETE FROM app.linkedin_sequence_send WHERE workspace_id=p_ws AND run_id=p_run AND step_index=x.step_index AND state='sending';
  UPDATE app.linkedin_sequence_run SET comment_holds=comment_holds+1,next_at=p_now+interval '1 hour',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_run;RETURN;
 END IF;
 UPDATE app.linkedin_sequence_run SET comment_holds=0 WHERE workspace_id=p_ws AND id=p_run;
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
CREATE OR REPLACE FUNCTION app.finish_linkedin_reply(p_reply text,p_outcome text,p_remote text,p_body text,p_error text,p_chat text) RETURNS void
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
 -- Only a message draft is completed by a reply; a comment waiting for approval stays in Aprovações.
 FOR x IN SELECT * FROM app.linkedin_sequence_run x0 WHERE workspace_id=ws AND person_id=person AND state='waiting'
   AND NOT EXISTS(SELECT 1 FROM app.linkedin_approval a WHERE a.workspace_id=x0.workspace_id AND a.run_id=x0.id AND a.step_index=x0.step_index AND a.state IN('pending','posting')) FOR UPDATE LOOP
  UPDATE app.linkedin_sequence_send SET state='done' WHERE workspace_id=ws AND run_id=x.id AND step_index=x.step_index AND state='drafted';
  PERFORM app.linkedin_sequence_advance(ws,x.id,clock_timestamp());
 END LOOP;
END $$;
