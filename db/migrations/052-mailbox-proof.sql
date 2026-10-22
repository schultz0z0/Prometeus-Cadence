CREATE TABLE app.email_proof_challenge(
 workspace_id text NOT NULL,mailbox_id text NOT NULL,message_id text NOT NULL,revision bigint NOT NULL,nonce_hash text NOT NULL CHECK(nonce_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',used_at timestamptz,
 PRIMARY KEY(workspace_id,message_id),FOREIGN KEY(workspace_id,mailbox_id) REFERENCES app.email_mailbox(workspace_id,id),FOREIGN KEY(workspace_id,message_id) REFERENCES app.channel_message(workspace_id,id)
);
ALTER TABLE app.email_proof_challenge ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.email_proof_challenge FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.email_proof_challenge FROM PUBLIC,cadence_app,cadence_ingress,cadence_dispatcher;
CREATE FUNCTION app.mailbox_proof_allowed(p_ws text,p_message text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.message_outbox o JOIN app.email_proof_challenge q ON q.workspace_id=o.workspace_id AND q.message_id=o.message_id
 JOIN app.email_mailbox m ON m.workspace_id=q.workspace_id AND m.id=q.mailbox_id JOIN app.channel_connection c ON c.workspace_id=m.workspace_id AND c.id=m.id
 WHERE o.workspace_id=p_ws AND o.message_id=p_message AND o.prepared_send->>'purpose'='test' AND o.prepared_send->>'channel'='EMAIL'
 AND o.prepared_send->>'address'=m.address AND o.prepared_send->>'to'=m.address AND q.revision=c.revision AND q.used_at IS NULL AND q.expires_at>clock_timestamp()
 AND m.provider='smtp-imap' AND m.state='verifying' AND m.send_verified AND m.read_verified AND m.baseline_at IS NOT NULL AND m.sync_state='ready' AND NOT m.sync_gap AND c.credentials_verified)
$$;
REVOKE ALL ON FUNCTION app.mailbox_proof_allowed(text,text) FROM PUBLIC,cadence_app,cadence_ingress,cadence_dispatcher;
CREATE FUNCTION app.enqueue_mail_test(p_message text,p_send jsonb,p_proof jsonb,p_preview text,p_challenge text,p_consent jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);actor text:=current_setting('app.user_id',true);s app.channel_sender;c app.channel_connection;m app.email_mailbox;identity_id text;conv_id text;thread_id text;is_proof boolean:=p_challenge IS NOT NULL;
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') OR p_send->>'channel'<>'EMAIL' OR p_send->>'purpose'<>'test' OR pg_column_size(p_send)>131072 OR octet_length(p_preview)>65536 THEN RAISE EXCEPTION 'INVALID_MAIL_TEST';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO s FROM app.channel_sender WHERE workspace_id=ws AND id=p_send->>'senderId' FOR UPDATE;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=ws AND id=s.connection_id FOR UPDATE;
 SELECT * INTO m FROM app.email_mailbox WHERE workspace_id=ws AND id=c.id FOR UPDATE;
 IF m.id IS NULL OR c.revision<>(p_send->>'connectionRevision')::bigint OR s.revision<>(p_proof->>'senderRevision')::bigint OR s.address<>p_send->>'address' OR m.signature<>p_send->'content'->>'signature' THEN RAISE EXCEPTION 'MAILBOX_CHANGED';END IF;
 IF is_proof THEN
  IF p_challenge!~'^[a-f0-9]{64}$' OR m.provider<>'smtp-imap' OR m.state<>'verifying' OR NOT c.credentials_verified OR NOT m.send_verified OR NOT m.read_verified OR m.baseline_at IS NULL OR m.sync_state<>'ready' OR p_send->>'to'<>m.address THEN RAISE EXCEPTION 'MAILBOX_PROOF_NOT_READY';END IF;
  IF(SELECT count(*) FROM app.email_proof_challenge WHERE workspace_id=ws AND mailbox_id=m.id AND created_at>clock_timestamp()-interval '1 hour')>=5 THEN RAISE EXCEPTION 'PROOF_RATE_LIMIT';END IF;
 ELSE IF m.state<>'ready' OR NOT s.ready OR p_consent IS NULL OR length(p_consent->>'source')<1 OR length(p_consent->>'evidence')<1 OR (p_consent->>'occurredAt')::timestamptz>clock_timestamp() THEN RAISE EXCEPTION 'MAIL_TEST_AUTHORIZATION_REQUIRED';END IF;END IF;
 INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES(ws,gen_random_uuid()::text,'email',p_send->>'to') ON CONFLICT(workspace_id,scope,external_id) DO NOTHING;
 SELECT id INTO identity_id FROM app.channel_identity WHERE workspace_id=ws AND scope='email' AND external_id=p_send->>'to';
 INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id,channel,thread_key) VALUES(ws,gen_random_uuid()::text,c.id,s.id,identity_id,'EMAIL','test:'||p_message) RETURNING id INTO conv_id;
 INSERT INTO app.email_thread(workspace_id,id,mailbox_id,conversation_id,thread_key,subject) VALUES(ws,gen_random_uuid()::text,c.id,conv_id,'test:'||p_message,p_send->'content'->>'subject') RETURNING id INTO thread_id;
 INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,channel,direction,text,purpose) VALUES(ws,p_message,c.id,s.id,identity_id,conv_id,'EMAIL','outbound',p_preview,'test');
 INSERT INTO app.email_message(workspace_id,message_id,mailbox_id,thread_id,rfc_message_id,subject,from_address,to_addresses,origin,classification) VALUES(ws,p_message,c.id,thread_id,p_send->>'rfcMessageId',p_send->'content'->>'subject',s.address,jsonb_build_array(p_send->>'to'),'app','human');
 INSERT INTO app.consent_evidence(workspace_id,id,identity_id,purpose,source,occurred_at,evidence,actor_id) VALUES(ws,gen_random_uuid()::text,identity_id,'test',CASE WHEN is_proof THEN 'own_mailbox_confirmation' ELSE p_consent->>'source' END,CASE WHEN is_proof THEN clock_timestamp() ELSE(p_consent->>'occurredAt')::timestamptz END,CASE WHEN is_proof THEN 'Explicitly confirmed one own-address verification message.' ELSE p_consent->>'evidence' END,actor);
 INSERT INTO app.message_outbox(workspace_id,message_id,connection_id,sender_id,identity_id,actor_id,authority_kind,prepared_send,proof) VALUES(ws,p_message,c.id,s.id,identity_id,actor,'admin',p_send,p_proof);
 IF is_proof THEN INSERT INTO app.email_proof_challenge(workspace_id,mailbox_id,message_id,revision,nonce_hash) VALUES(ws,m.id,p_message,c.revision,p_challenge);END IF;
 RETURN p_message;
END $$;
REVOKE ALL ON FUNCTION app.enqueue_mail_test(text,jsonb,jsonb,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enqueue_mail_test(text,jsonb,jsonb,text,text,jsonb) TO cadence_app;
CREATE FUNCTION app.verify_incoming_mail_proof() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q app.email_proof_challenge;m app.email_mailbox;cm app.channel_message;word text;expected text;owner app.email_address_ownership;
BEGIN
 SELECT * INTO cm FROM app.channel_message WHERE workspace_id=NEW.workspace_id AND id=NEW.message_id;
 IF cm.direction<>'inbound' OR NEW.truncated THEN RETURN NEW;END IF;
 SELECT * INTO m FROM app.email_mailbox WHERE workspace_id=NEW.workspace_id AND id=NEW.mailbox_id;
 IF NEW.from_address<>m.address OR NEW.to_addresses<>jsonb_build_array(m.address) OR NOT m.read_verified OR NOT m.send_verified THEN RETURN NEW;END IF;
 FOR q IN SELECT ch.* FROM app.email_proof_challenge ch JOIN app.channel_connection c ON c.workspace_id=ch.workspace_id AND c.id=ch.mailbox_id
  WHERE ch.workspace_id=NEW.workspace_id AND ch.mailbox_id=NEW.mailbox_id AND ch.revision=c.revision AND ch.used_at IS NULL AND ch.expires_at>clock_timestamp() AND m.baseline_at<=ch.created_at AND cm.occurred_at>=ch.created_at-interval '5 seconds' AND cm.occurred_at<=clock_timestamp()+interval '5 minutes' LOOP
  FOR word IN SELECT (regexp_matches(COALESCE(cm.text,''),'[A-Za-z0-9_-]{43}','g'))[1] LOOP
   expected:=encode(sha256(convert_to('["'||q.mailbox_id||'",'||q.revision||',"'||word||'"]','UTF8')),'hex');
   IF expected=q.nonce_hash THEN
    INSERT INTO app.email_address_ownership(address,workspace_id,connection_id) VALUES(m.address,m.workspace_id,m.id) ON CONFLICT DO NOTHING;
    SELECT * INTO owner FROM app.email_address_ownership WHERE address=m.address;
    IF owner.workspace_id<>m.workspace_id OR owner.connection_id<>m.id THEN RAISE EXCEPTION 'MAIL_ADDRESS_ALREADY_OWNED';END IF;
    UPDATE app.email_proof_challenge SET used_at=clock_timestamp() WHERE workspace_id=q.workspace_id AND message_id=q.message_id;
    UPDATE app.email_mailbox SET proof_verified=true WHERE workspace_id=m.workspace_id AND id=m.id;RETURN NEW;
   END IF;
  END LOOP;
 END LOOP;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.verify_incoming_mail_proof() FROM PUBLIC;
CREATE TRIGGER mail_proof_after_metadata AFTER INSERT ON app.email_message FOR EACH ROW EXECUTE FUNCTION app.verify_incoming_mail_proof();
DO $$ DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('app.message_dispatch_scope(text,text)'::regprocedure) INTO definition;
 definition:=replace(definition,'END IF;RETURN data;','END IF;data:=data||jsonb_build_object(''mailboxProof'',app.mailbox_proof_allowed(p_ws,p_message));data:=jsonb_set(data,''{guard}'',data->''guard''||jsonb_build_object(''mailboxProof'',data->''mailboxProof''));RETURN data;');
 EXECUTE definition;
 SELECT pg_get_functiondef('app.read_message_dispatch(text,text,text,bigint)'::regprocedure) INTO definition;
 definition:=replace(definition,'state->''connection''->>''state''<>''ready'' OR','(state->''connection''->>''state''<>''ready'' AND NOT app.mailbox_proof_allowed(p_ws,p_message)) OR');EXECUTE definition;
 SELECT pg_get_functiondef('app.begin_message_dispatch_legacy(text,text,text,text,bigint,jsonb,timestamptz)'::regprocedure) INTO definition;
 definition:=replace(definition,'scope_data->''connection''->>''state''<>''ready'' OR','(scope_data->''connection''->>''state''<>''ready'' AND NOT app.mailbox_proof_allowed(p_ws,p_message)) OR');
 definition:=replace(definition,'OR NOT(scope_data->''sender''->>''ready'')::boolean','OR (NOT(scope_data->''sender''->>''ready'')::boolean AND NOT app.mailbox_proof_allowed(p_ws,p_message))');EXECUTE definition;
 SELECT pg_get_functiondef('app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz)'::regprocedure) INTO definition;
 definition:=replace(definition,'IF box.id IS NULL OR box.state<>''ready'' OR NOT box.proof_verified OR NOT box.send_verified OR NOT box.read_verified OR box.bounce_paused OR box.sync_gap THEN',
 'IF NOT app.mailbox_proof_allowed(p_ws,p_message) AND (box.id IS NULL OR box.state<>''ready'' OR NOT box.proof_verified OR NOT box.send_verified OR NOT box.read_verified OR box.bounce_paused OR box.sync_gap) THEN');
 EXECUTE definition;
END $$;
