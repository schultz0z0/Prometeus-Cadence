-- All token refresh paths serialize with rotation before taking mailbox/connection locks.
DO $$ DECLARE signature text;definition text;BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'app.sync_mail_refresh(text,text,text,bigint,bigint,text,jsonb,timestamptz,text)',
  'app.dispatch_mail_refresh(text,text,text,bigint,bigint,text,jsonb,timestamptz,text)'
 ] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
  EXECUTE replace(definition,'BEGIN'||chr(10)||' scope_data:=','BEGIN'||chr(10)||' PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;'||chr(10)||' scope_data:=');
 END LOOP;
 SELECT pg_get_functiondef('app.message_dispatch_scope_legacy(text,text)'::regprocedure) INTO definition;
 EXECUTE replace(definition,'SELECT last_inbound_at INTO last_inbound FROM app.channel_conversation WHERE workspace_id=p_ws AND sender_id=o.sender_id AND identity_id=o.identity_id;',
 'SELECT last_inbound_at INTO last_inbound FROM app.channel_conversation WHERE workspace_id=p_ws AND sender_id=o.sender_id AND identity_id=o.identity_id AND id=(SELECT conversation_id FROM app.channel_message WHERE workspace_id=p_ws AND id=p_message);');
END $$;
