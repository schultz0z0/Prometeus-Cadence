CREATE TABLE app.email_thread_review(
 workspace_id text NOT NULL,request_id text NOT NULL,conversation_id text NOT NULL,mailbox_id text NOT NULL,
 connection_revision bigint NOT NULL,last_message_id text NOT NULL,user_id text NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 20 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,request_id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES app.channel_conversation(workspace_id,id),
 FOREIGN KEY(workspace_id,mailbox_id) REFERENCES app.email_mailbox(workspace_id,id),FOREIGN KEY(workspace_id,last_message_id) REFERENCES app.channel_message(workspace_id,id)
);
ALTER TABLE app.email_thread_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.email_thread_review FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.email_thread_review FROM PUBLIC,cadence_app,cadence_ingress,cadence_dispatcher;
CREATE FUNCTION app.acknowledge_mail_thread(p_id text,p_revision bigint,p_last text,p_request text,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);thread app.email_thread;
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') OR length(btrim(p_reason)) NOT BETWEEN 20 AND 2000 THEN RAISE EXCEPTION 'REVIEW_REQUIRED';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO thread FROM app.email_thread WHERE workspace_id=ws AND conversation_id=p_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'THREAD_CHANGED';END IF;
 IF NOT EXISTS(SELECT 1 FROM app.channel_connection WHERE workspace_id=ws AND id=thread.mailbox_id AND revision=p_revision)
 OR p_last IS DISTINCT FROM(SELECT id FROM app.channel_message WHERE workspace_id=ws AND conversation_id=p_id ORDER BY message_order DESC LIMIT 1) THEN RAISE EXCEPTION 'THREAD_CHANGED';END IF;
 INSERT INTO app.email_thread_review(workspace_id,request_id,conversation_id,mailbox_id,connection_revision,last_message_id,user_id,reason)
 VALUES(ws,p_request,p_id,thread.mailbox_id,p_revision,p_last,current_setting('app.user_id',true),p_reason);
 UPDATE app.email_thread SET needs_review=false WHERE workspace_id=ws AND conversation_id=p_id;
 -- The acknowledgement does not invent freshness or resume campaigns. A new
 -- authenticated sync and separate mailbox recovery remain necessary.
 INSERT INTO app.audit(workspace_id,user_id,action) VALUES(ws,current_setting('app.user_id',true),'mail.thread.reviewed');
END $$;
REVOKE ALL ON FUNCTION app.acknowledge_mail_thread(text,bigint,text,text,text) FROM PUBLIC,cadence_ingress,cadence_dispatcher;
GRANT EXECUTE ON FUNCTION app.acknowledge_mail_thread(text,bigint,text,text,text) TO cadence_app;
