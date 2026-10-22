CREATE FUNCTION app.unsubscribe_mail_hash(p_hash text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item app.email_unsubscribe_token;
BEGIN
 IF p_hash!~'^[a-f0-9]{64}$' THEN RETURN;END IF;
 SELECT * INTO item FROM app.email_unsubscribe_token WHERE token_hash=p_hash;IF NOT FOUND THEN RETURN;END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=item.workspace_id FOR UPDATE;
 INSERT INTO app.contact_suppression(workspace_id,identity_id,scope,reason) VALUES(item.workspace_id,item.identity_id,'all','email_unsubscribe') ON CONFLICT DO NOTHING;
 UPDATE app.email_unsubscribe_token SET used_at=COALESCE(used_at,clock_timestamp()) WHERE token_hash=p_hash;
END $$;
REVOKE ALL ON FUNCTION app.unsubscribe_mail_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.unsubscribe_mail_hash(text) TO cadence_app;
CREATE FUNCTION app.provision_mail_sender(p_id text,p_revision bigint) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);m app.email_mailbox;c app.channel_connection;sender_id text;
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 SELECT * INTO m FROM app.email_mailbox WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF m.provider<>'smtp-imap' OR c.revision<>p_revision OR NOT c.credentials_verified OR NOT m.read_verified OR NOT m.send_verified THEN RAISE EXCEPTION 'MAILBOX_CHANGED';END IF;
 INSERT INTO app.channel_sender(workspace_id,id,connection_id,provider,channel,address,external_id,identity_scope,ready) VALUES(ws,gen_random_uuid()::text,p_id,'smtp-imap','EMAIL',m.address,m.address,'email',false)
 ON CONFLICT(workspace_id,connection_id,external_id) DO UPDATE SET address=EXCLUDED.address,ready=false;
 SELECT id INTO sender_id FROM app.channel_sender WHERE workspace_id=ws AND connection_id=p_id AND external_id=m.address;
 RETURN sender_id;
END $$;
REVOKE ALL ON FUNCTION app.provision_mail_sender(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.provision_mail_sender(text,bigint) TO cadence_app;
CREATE FUNCTION app.resume_mailbox(p_id text,p_revision bigint,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') OR length(btrim(p_reason)) NOT BETWEEN 20 AND 2000 THEN RAISE EXCEPTION 'REVIEW_REQUIRED';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM app.channel_connection c JOIN app.email_mailbox m ON m.workspace_id=c.workspace_id AND m.id=c.id WHERE c.workspace_id=ws AND c.id=p_id AND c.revision=p_revision AND c.credentials_verified AND m.state IN('verifying','attention','ready')) THEN RAISE EXCEPTION 'MAILBOX_CHANGED';END IF;
 UPDATE app.email_mailbox SET bounce_paused=false,sync_gap=false,sync_state='baseline',state='verifying',last_error=NULL WHERE workspace_id=ws AND id=p_id;
 UPDATE app.channel_sender SET ready=false WHERE workspace_id=ws AND connection_id=p_id;
 UPDATE app.email_sync_cursor SET next_at=clock_timestamp() WHERE workspace_id=ws AND mailbox_id=p_id;
 INSERT INTO app.audit(workspace_id,user_id,action) VALUES(ws,current_setting('app.user_id',true),'mailbox.resume.reviewed');
END $$;
REVOKE ALL ON FUNCTION app.resume_mailbox(text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resume_mailbox(text,bigint,text) TO cadence_app;
