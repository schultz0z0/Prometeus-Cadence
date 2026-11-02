-- 06F.1: private assistant history per user and workspace. Answers never carry credentials or other workspaces' data.
CREATE TABLE app.assistant_thread(
 workspace_id text NOT NULL REFERENCES auth.organization(id),user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
 id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,user_id,id)
);
CREATE INDEX assistant_thread_recent ON app.assistant_thread(workspace_id,user_id,updated_at DESC);
CREATE TABLE app.assistant_message(
 workspace_id text NOT NULL,user_id text NOT NULL,thread_id text NOT NULL,id text NOT NULL DEFAULT gen_random_uuid()::text,
 request_id text NOT NULL,role text NOT NULL CHECK(role IN('user','assistant')),text text NOT NULL CHECK(length(text) BETWEEN 1 AND 4000),
 citations jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(citations)='array' AND jsonb_array_length(citations)<=10),
 fallback boolean NOT NULL DEFAULT false,provider text,input_tokens integer,output_tokens integer,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,user_id,id),UNIQUE(workspace_id,user_id,request_id,role),
 FOREIGN KEY(workspace_id,user_id,thread_id) REFERENCES app.assistant_thread(workspace_id,user_id,id) ON DELETE CASCADE
);
CREATE INDEX assistant_message_thread ON app.assistant_message(workspace_id,user_id,thread_id,created_at,id);
CREATE INDEX assistant_message_daily ON app.assistant_message(workspace_id,created_at) WHERE role='user';
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['assistant_thread','assistant_message'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
 EXECUTE format('CREATE POLICY own_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND user_id=current_setting(''app.user_id'',true) AND app.current_role() IS NOT NULL)',t);
END LOOP;END $$;
GRANT SELECT ON app.assistant_thread,app.assistant_message TO cadence_app;

-- Records the question before any model I/O. Same request id returns the stored question; the daily caps hold under concurrency.
CREATE FUNCTION app.assistant_ask(p_thread text,p_request text,p_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);q app.assistant_message;th text:=p_thread;day timestamptz;
BEGIN
 IF app.lock_membership() IS NULL THEN RAISE EXCEPTION 'ASSISTANT_ACCESS';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(ws||':assistant',0));
 SELECT * INTO q FROM app.assistant_message WHERE workspace_id=ws AND user_id=uid AND request_id=p_request AND role='user';
 IF FOUND THEN
  IF q.text<>p_text OR (p_thread IS NOT NULL AND q.thread_id<>p_thread) THEN RAISE EXCEPTION 'ASSISTANT_REPLAY_CHANGED';END IF;
  RETURN jsonb_build_object('threadId',q.thread_id,'questionId',q.id,'replay',true);
 END IF;
 IF length(btrim(coalesce(p_text,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'ASSISTANT_INVALID';END IF;
 day:=date_trunc('day',clock_timestamp() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
 IF (SELECT count(*) FROM app.assistant_message WHERE workspace_id=ws AND user_id=uid AND role='user' AND created_at>=day)>=30
 OR (SELECT count(*) FROM app.assistant_message WHERE workspace_id=ws AND role='user' AND created_at>=day)>=200 THEN RAISE EXCEPTION 'ASSISTANT_LIMIT';END IF;
 IF th IS NULL THEN th:=gen_random_uuid()::text;INSERT INTO app.assistant_thread(workspace_id,user_id,id) VALUES(ws,uid,th);
 ELSE UPDATE app.assistant_thread SET updated_at=clock_timestamp() WHERE workspace_id=ws AND user_id=uid AND id=th;IF NOT FOUND THEN RAISE EXCEPTION 'ASSISTANT_NOT_FOUND';END IF;END IF;
 INSERT INTO app.assistant_message(workspace_id,user_id,thread_id,request_id,role,text) VALUES(ws,uid,th,p_request,'user',btrim(p_text)) RETURNING * INTO q;
 RETURN jsonb_build_object('threadId',th,'questionId',q.id,'replay',false);
END $$;

-- Called after model I/O: membership is checked again, so a member removed meanwhile gets nothing stored or returned.
CREATE FUNCTION app.assistant_reply(p_request text,p_text text,p_citations jsonb,p_fallback boolean,p_provider text,p_in integer,p_out integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);q app.assistant_message;id text;
BEGIN
 IF app.lock_membership() IS NULL THEN RAISE EXCEPTION 'ASSISTANT_ACCESS';END IF;
 SELECT * INTO q FROM app.assistant_message WHERE workspace_id=ws AND user_id=uid AND request_id=p_request AND role='user';
 IF NOT FOUND THEN RAISE EXCEPTION 'ASSISTANT_NOT_FOUND';END IF;
 INSERT INTO app.assistant_message(workspace_id,user_id,thread_id,request_id,role,text,citations,fallback,provider,input_tokens,output_tokens)
 VALUES(ws,uid,q.thread_id,p_request,'assistant',p_text,p_citations,p_fallback,p_provider,p_in,p_out) ON CONFLICT(workspace_id,user_id,request_id,role) DO NOTHING;
 SELECT m.id INTO id FROM app.assistant_message m WHERE m.workspace_id=ws AND m.user_id=uid AND m.request_id=p_request AND m.role='assistant';
 UPDATE app.assistant_thread SET updated_at=clock_timestamp() WHERE workspace_id=ws AND user_id=uid AND assistant_thread.id=q.thread_id;
 RETURN id;
END $$;
REVOKE ALL ON FUNCTION app.assistant_ask(text,text,text),app.assistant_reply(text,text,jsonb,boolean,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assistant_ask(text,text,text),app.assistant_reply(text,text,jsonb,boolean,text,integer,integer) TO cadence_app;
