ALTER TABLE app.email_mailbox ADD COLUMN refresh_token_lock text;
ALTER TABLE app.email_mailbox ADD COLUMN refresh_lock_until timestamptz;
CREATE FUNCTION app.begin_mail_oauth(p_id text,p_revision bigint,p_attempt text,p_state text,p_session text,p_envelope jsonb,p_expires timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);conn app.channel_connection;
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO conn FROM app.channel_connection WHERE workspace_id=ws AND id=p_id AND channel='EMAIL' AND provider='gmail' FOR UPDATE;
 IF NOT FOUND OR conn.revision<>p_revision THEN RAISE EXCEPTION 'MAIL_CHANGED';END IF;
 IF length(p_state)<>64 OR length(p_session)<>64 OR pg_column_size(p_envelope)>8192 OR p_expires<=clock_timestamp() OR p_expires>clock_timestamp()+interval '10 minutes' THEN RAISE EXCEPTION 'INVALID_OAUTH';END IF;
 INSERT INTO app.email_oauth_attempt(workspace_id,id,connection_id,user_id,session_hash,state_hash,revision,envelope,expires_at) VALUES(ws,p_attempt,p_id,current_setting('app.user_id',true),p_session,p_state,p_revision,p_envelope,p_expires);
END $$;
CREATE FUNCTION app.consume_mail_oauth(p_state text,p_session text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.email_oauth_attempt;conn app.channel_connection;
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO a FROM app.email_oauth_attempt WHERE workspace_id=current_setting('app.workspace_id',true) AND user_id=current_setting('app.user_id',true) AND state_hash=p_state AND session_hash=p_session FOR UPDATE;
 IF NOT FOUND OR a.used_at IS NOT NULL OR a.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'OAUTH_EXPIRED';END IF;
 SELECT * INTO conn FROM app.channel_connection WHERE workspace_id=a.workspace_id AND id=a.connection_id FOR UPDATE;
 IF conn.revision<>a.revision THEN RAISE EXCEPTION 'MAIL_CHANGED';END IF;
 UPDATE app.email_oauth_attempt SET used_at=clock_timestamp() WHERE workspace_id=a.workspace_id AND id=a.id;
 RETURN to_jsonb(a);
END $$;
CREATE FUNCTION app.finish_mail_oauth(p_attempt text,p_revision bigint,p_address text,p_envelope jsonb,p_expires timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.email_oauth_attempt;conn app.channel_connection;box app.email_mailbox;ownership app.email_address_ownership;
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO a FROM app.email_oauth_attempt WHERE workspace_id=ws AND id=p_attempt AND user_id=current_setting('app.user_id',true) FOR UPDATE;
 IF NOT FOUND OR a.used_at IS NULL OR a.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'OAUTH_EXPIRED';END IF;
 SELECT * INTO conn FROM app.channel_connection WHERE workspace_id=ws AND id=a.connection_id AND provider='gmail' FOR UPDATE;
 SELECT * INTO box FROM app.email_mailbox WHERE workspace_id=ws AND id=a.connection_id FOR UPDATE;
 IF conn.revision<>p_revision OR a.revision<>p_revision OR(box.address IS NOT NULL AND box.address<>p_address) THEN RAISE EXCEPTION 'MAIL_CHANGED';END IF;
 IF length(p_address) NOT BETWEEN 3 AND 254 OR pg_column_size(p_envelope)>131072 THEN RAISE EXCEPTION 'INVALID_OAUTH';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('email-owner:'||p_address));
 SELECT * INTO ownership FROM app.email_address_ownership WHERE address=p_address;
 IF FOUND AND(ownership.workspace_id<>ws OR ownership.connection_id<>conn.id) THEN RAISE EXCEPTION 'MAIL_ADDRESS_IN_USE';END IF;
 INSERT INTO app.email_address_ownership(address,workspace_id,connection_id) VALUES(p_address,ws,conn.id) ON CONFLICT DO NOTHING;
 UPDATE app.channel_connection SET revision=p_revision+1,credentials_verified=true,external_account_id=p_address,token_expires_at=p_expires,state='credentials_verified',identifiers=identifiers||'{"hasSecrets":true}'::jsonb,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=conn.id;
 INSERT INTO app.channel_credential(workspace_id,connection_id,revision,envelope,identifiers,verified_account_id) VALUES(ws,conn.id,p_revision+1,p_envelope,conn.identifiers,p_address);
 INSERT INTO app.channel_sender(workspace_id,id,connection_id,provider,channel,address,external_id,identity_scope,ready) VALUES(ws,gen_random_uuid()::text,conn.id,'gmail','EMAIL',p_address,p_address,'email',false)
 ON CONFLICT(workspace_id,connection_id,external_id) DO UPDATE SET ready=false,revision=app.channel_sender.revision+1;
 UPDATE app.email_mailbox SET address=p_address,state='verifying',send_verified=true,read_verified=true,proof_verified=true,last_error=NULL,refresh_token_lock=NULL,refresh_lock_until=NULL WHERE workspace_id=ws AND id=conn.id;
END $$;
CREATE FUNCTION app.claim_mail_refresh(p_id text,p_revision bigint,p_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 UPDATE app.email_mailbox m SET refresh_token_lock=p_token,refresh_lock_until=clock_timestamp()+interval '45 seconds'
 FROM app.channel_connection c WHERE m.workspace_id=current_setting('app.workspace_id',true) AND m.id=p_id AND c.workspace_id=m.workspace_id AND c.id=m.id AND c.revision=p_revision AND c.provider='gmail' AND m.state NOT IN('disconnected','authorization_required') AND(m.refresh_lock_until IS NULL OR m.refresh_lock_until<clock_timestamp());RETURN FOUND;
END $$;
CREATE FUNCTION app.finish_mail_refresh(p_id text,p_revision bigint,p_token text,p_envelope jsonb,p_expires timestamptz,p_error text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);box app.email_mailbox;conn app.channel_connection;
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO box FROM app.email_mailbox WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 SELECT * INTO conn FROM app.channel_connection WHERE workspace_id=ws AND id=p_id AND provider='gmail' FOR UPDATE;
 IF NOT FOUND OR conn.revision<>p_revision OR box.refresh_token_lock IS DISTINCT FROM p_token OR box.refresh_lock_until<clock_timestamp() OR box.state='disconnected' THEN RETURN false;END IF;
 IF p_error='invalid_grant' THEN
  UPDATE app.email_mailbox SET state='authorization_required',send_verified=false,read_verified=false,last_error='GMAIL_RECONNECT_REQUIRED' WHERE workspace_id=ws AND id=p_id;
  UPDATE app.channel_connection SET state='attention',credentials_verified=false WHERE workspace_id=ws AND id=p_id;
  UPDATE app.channel_sender SET ready=false WHERE workspace_id=ws AND connection_id=p_id;
 ELSIF p_error IS NULL THEN
  IF p_envelope IS NULL OR pg_column_size(p_envelope)>131072 THEN RAISE EXCEPTION 'INVALID_CREDENTIAL';END IF;
  UPDATE app.channel_credential SET envelope=p_envelope WHERE workspace_id=ws AND connection_id=p_id AND revision=p_revision;
  UPDATE app.channel_connection SET token_expires_at=p_expires WHERE workspace_id=ws AND id=p_id;
 END IF;
 UPDATE app.email_mailbox SET refresh_token_lock=NULL,refresh_lock_until=NULL WHERE workspace_id=ws AND id=p_id;RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.begin_mail_oauth(text,bigint,text,text,text,jsonb,timestamptz),app.consume_mail_oauth(text,text),app.finish_mail_oauth(text,bigint,text,jsonb,timestamptz),app.claim_mail_refresh(text,bigint,text),app.finish_mail_refresh(text,bigint,text,jsonb,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.begin_mail_oauth(text,bigint,text,text,text,jsonb,timestamptz),app.consume_mail_oauth(text,text),app.finish_mail_oauth(text,bigint,text,jsonb,timestamptz),app.claim_mail_refresh(text,bigint,text),app.finish_mail_refresh(text,bigint,text,jsonb,timestamptz,text) TO cadence_app;
