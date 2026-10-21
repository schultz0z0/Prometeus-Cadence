ALTER TABLE app.channel_conversation ADD COLUMN lead_link_evidence jsonb;
GRANT UPDATE(lead_link_evidence) ON app.channel_conversation TO cadence_app;
CREATE FUNCTION app.enqueue_reviewed_message(p_sender text,p_identity text,p_conversation text,p_send jsonb,p_proof jsonb,p_text text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);actor text:=current_setting('app.user_id',true);actor_role text:=app.current_role();sender app.channel_sender;conn app.channel_connection;conv app.channel_conversation;msg text:=gen_random_uuid()::text;purpose text:=p_send->>'purpose';
BEGIN
 IF actor_role IS NULL OR purpose NOT IN('service','test') OR (purpose='test' AND actor_role NOT IN('owner','admin')) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF pg_column_size(p_send)>65536 OR pg_column_size(p_proof)>65536 OR length(p_text)>4096 THEN RAISE EXCEPTION 'INVALID_MESSAGE';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO sender FROM app.channel_sender WHERE workspace_id=ws AND id=p_sender FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'SENDER_NOT_FOUND';END IF;
 SELECT * INTO conn FROM app.channel_connection WHERE workspace_id=ws AND id=sender.connection_id FOR UPDATE;
 IF conn.state<>'ready' OR NOT sender.ready OR conn.revision<>(p_send->>'connectionRevision')::bigint OR sender.revision<>(p_proof->>'senderRevision')::bigint OR p_send->>'connectionId'<>conn.id OR p_send->>'senderId'<>sender.id THEN RAISE EXCEPTION 'CONNECTION_CHANGED';END IF;
 SELECT * INTO conv FROM app.channel_conversation WHERE workspace_id=ws AND id=p_conversation AND sender_id=sender.id AND connection_id=conn.id AND identity_id=p_identity;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND';END IF;
 INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,text,purpose) VALUES(ws,msg,conn.id,sender.id,p_identity,conv.id,'outbound',p_text,purpose);
 INSERT INTO app.message_outbox(workspace_id,message_id,connection_id,sender_id,identity_id,actor_id,authority_kind,prepared_send,proof)
  VALUES(ws,msg,conn.id,sender.id,p_identity,actor,CASE WHEN purpose='test' THEN 'admin' ELSE 'member' END,p_send,p_proof);
 RETURN msg;
END $$;
REVOKE ALL ON FUNCTION app.enqueue_reviewed_message(text,text,text,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enqueue_reviewed_message(text,text,text,jsonb,jsonb,text) TO cadence_app;
