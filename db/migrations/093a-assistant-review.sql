-- 06F.1 review: a question holds a short generation lease and at most 3 attempts, so replaying one request id cannot multiply model calls.
ALTER TABLE app.assistant_message ADD COLUMN generating_until timestamptz,ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3);
CREATE OR REPLACE FUNCTION app.assistant_ask(p_thread text,p_request text,p_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);q app.assistant_message;th text:=p_thread;day timestamptz;
BEGIN
 IF app.lock_membership() IS NULL THEN RAISE EXCEPTION 'ASSISTANT_ACCESS';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(ws||':assistant',0));
 SELECT * INTO q FROM app.assistant_message WHERE workspace_id=ws AND user_id=uid AND request_id=p_request AND role='user' FOR UPDATE;
 IF FOUND THEN
  IF q.text<>btrim(p_text) OR (p_thread IS NOT NULL AND q.thread_id<>p_thread) THEN RAISE EXCEPTION 'ASSISTANT_REPLAY_CHANGED';END IF;
  IF EXISTS(SELECT 1 FROM app.assistant_message WHERE workspace_id=ws AND user_id=uid AND request_id=p_request AND role='assistant') THEN
   RETURN jsonb_build_object('threadId',q.thread_id,'questionId',q.id,'replay',true,'generate',false);END IF;
  IF q.generating_until>clock_timestamp() THEN RAISE EXCEPTION 'ASSISTANT_BUSY';END IF;
  -- After 3 abandoned attempts the answer comes from the help center, without another model call.
  IF q.attempts>=3 THEN RETURN jsonb_build_object('threadId',q.thread_id,'questionId',q.id,'replay',true,'generate',false);END IF;
  UPDATE app.assistant_message SET attempts=attempts+1,generating_until=clock_timestamp()+interval '90 seconds' WHERE workspace_id=ws AND user_id=uid AND id=q.id;
  RETURN jsonb_build_object('threadId',q.thread_id,'questionId',q.id,'replay',true,'generate',true);
 END IF;
 IF length(btrim(coalesce(p_text,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'ASSISTANT_INVALID';END IF;
 day:=date_trunc('day',clock_timestamp() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
 IF (SELECT count(*) FROM app.assistant_message WHERE workspace_id=ws AND user_id=uid AND role='user' AND created_at>=day)>=30
 OR (SELECT count(*) FROM app.assistant_message WHERE workspace_id=ws AND role='user' AND created_at>=day)>=200 THEN RAISE EXCEPTION 'ASSISTANT_LIMIT';END IF;
 IF th IS NULL THEN th:=gen_random_uuid()::text;INSERT INTO app.assistant_thread(workspace_id,user_id,id) VALUES(ws,uid,th);
 ELSE UPDATE app.assistant_thread SET updated_at=clock_timestamp() WHERE workspace_id=ws AND user_id=uid AND id=th;IF NOT FOUND THEN RAISE EXCEPTION 'ASSISTANT_NOT_FOUND';END IF;END IF;
 INSERT INTO app.assistant_message(workspace_id,user_id,thread_id,request_id,role,text,attempts,generating_until) VALUES(ws,uid,th,p_request,'user',btrim(p_text),1,clock_timestamp()+interval '90 seconds') RETURNING * INTO q;
 RETURN jsonb_build_object('threadId',th,'questionId',q.id,'replay',false,'generate',true);
END $$;
-- Remaining questions honor both caps, so the panel never promises an answer the workspace cap would refuse.
CREATE FUNCTION app.assistant_remaining() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH d AS(SELECT date_trunc('day',clock_timestamp() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS day)
 SELECT CASE WHEN app.current_role() IS NULL THEN 0 ELSE greatest(0,least(
  30-(SELECT count(*) FROM app.assistant_message m,d WHERE m.workspace_id=current_setting('app.workspace_id',true) AND m.user_id=current_setting('app.user_id',true) AND m.role='user' AND m.created_at>=d.day),
  200-(SELECT count(*) FROM app.assistant_message m,d WHERE m.workspace_id=current_setting('app.workspace_id',true) AND m.role='user' AND m.created_at>=d.day)))::integer END
$$;
REVOKE ALL ON FUNCTION app.assistant_remaining() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assistant_remaining() TO cadence_app;
