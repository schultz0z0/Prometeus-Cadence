ALTER TABLE app.channel_credential ADD COLUMN identifiers jsonb NOT NULL DEFAULT '{}';
ALTER TABLE app.channel_credential ADD COLUMN verified_account_id text;
UPDATE app.channel_credential cr SET identifiers=c.identifiers FROM app.channel_connection c WHERE cr.workspace_id=c.workspace_id AND cr.connection_id=c.id;
CREATE OR REPLACE FUNCTION app.write_channel_credential(p_id text,p_revision bigint,p_envelope jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE conn app.channel_connection;
BEGIN
 IF app.current_role() NOT IN('owner','admin') OR app.current_role() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO conn FROM app.channel_connection WHERE workspace_id=current_setting('app.workspace_id',true) AND id=p_id FOR UPDATE;
 IF NOT FOUND OR conn.revision<>p_revision OR pg_column_size(p_envelope)>131072 THEN RAISE EXCEPTION 'CHANNEL_CHANGED';END IF;
 IF NOT(p_envelope ?& ARRAY['keyId','iv','tag','ciphertext']) THEN RAISE EXCEPTION 'INVALID_CREDENTIAL';END IF;
 INSERT INTO app.channel_credential(workspace_id,connection_id,revision,envelope,identifiers) VALUES(conn.workspace_id,conn.id,p_revision,p_envelope,conn.identifiers);
END $$;
CREATE FUNCTION app.verify_channel_assets(p_id text,p_revision bigint,p_assets jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE conn app.channel_connection;ws text:=current_setting('app.workspace_id',true);account text;item jsonb;owner_ws text;owner_conn text;
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO conn FROM app.channel_connection WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND OR conn.revision<>p_revision OR conn.state='disconnected' THEN RAISE EXCEPTION 'CHANNEL_CHANGED';END IF;
 IF pg_column_size(p_assets)>65536 OR jsonb_typeof(p_assets->'senders')<>'array' OR jsonb_array_length(p_assets->'senders') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_ASSETS';END IF;
 account:=p_assets->>'externalAccountId';
 IF account IS NULL OR account<>(CASE WHEN conn.provider='meta' THEN conn.identifiers->>'wabaId' ELSE conn.identifiers->>'accountSid' END) THEN RAISE EXCEPTION 'INVALID_ASSETS';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('channel-owner:'||conn.provider||':'||account));
 SELECT workspace_id INTO owner_ws FROM app.channel_account_ownership WHERE provider=conn.provider AND external_account_id=account AND external_sender_id='';
 IF FOUND AND owner_ws<>ws THEN RAISE EXCEPTION 'CHANNEL_ACCOUNT_IN_USE';END IF;
 INSERT INTO app.channel_account_ownership(provider,external_account_id,workspace_id,connection_id) VALUES(conn.provider,account,ws,p_id) ON CONFLICT DO NOTHING;
 FOR item IN SELECT value FROM jsonb_array_elements(p_assets->'senders') LOOP
  IF length(item->>'externalId') NOT BETWEEN 1 AND 100 OR length(item->>'identityScope') NOT BETWEEN 1 AND 200 OR length(item->>'id') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_ASSETS';END IF;
  SELECT workspace_id,connection_id INTO owner_ws,owner_conn FROM app.channel_account_ownership WHERE provider=conn.provider AND external_account_id=account AND external_sender_id=item->>'externalId';
  IF FOUND AND (owner_ws<>ws OR owner_conn<>p_id) THEN RAISE EXCEPTION 'CHANNEL_SENDER_IN_USE';END IF;
  INSERT INTO app.channel_account_ownership(provider,external_account_id,external_sender_id,workspace_id,connection_id) VALUES(conn.provider,account,item->>'externalId',ws,p_id) ON CONFLICT DO NOTHING;
  INSERT INTO app.channel_sender(workspace_id,id,connection_id,provider,address,external_id,identity_scope,capabilities)
   VALUES(ws,item->>'id',p_id,conn.provider,item->>'address',item->>'externalId',item->>'identityScope',COALESCE(item->'capabilities','{}'))
   ON CONFLICT(workspace_id,connection_id,external_id) DO UPDATE SET address=EXCLUDED.address,identity_scope=EXCLUDED.identity_scope,capabilities=EXCLUDED.capabilities;
 END LOOP;
 UPDATE app.channel_credential SET verified_account_id=account WHERE workspace_id=ws AND connection_id=p_id AND revision=p_revision;
 UPDATE app.channel_connection SET external_account_id=account,credentials_verified=true,state=CASE WHEN inbound_verified THEN 'ready' ELSE 'awaiting_webhook' END,last_error=NULL,token_expires_at=(p_assets->>'tokenExpiresAt')::timestamptz,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id;
 UPDATE app.channel_sender SET ready=conn.inbound_verified WHERE workspace_id=ws AND connection_id=p_id;
END $$;
REVOKE ALL ON FUNCTION app.verify_channel_assets(text,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.verify_channel_assets(text,bigint,jsonb) TO cadence_app;

CREATE FUNCTION app.lookup_channel_ingress(p_public text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE conn app.channel_connection;result jsonb;
BEGIN
 IF length(p_public) NOT BETWEEN 20 AND 100 THEN RETURN NULL;END IF;
 SELECT * INTO conn FROM app.channel_connection WHERE public_id=p_public;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('id',conn.id,'workspaceId',conn.workspace_id,'publicId',conn.public_id,'provider',conn.provider,'revision',conn.revision,'state',conn.state,'externalAccountId',conn.external_account_id,'identifiers',conn.identifiers,
  'senders',COALESCE((SELECT jsonb_agg(jsonb_build_object('externalId',external_id,'address',address)) FROM app.channel_sender WHERE workspace_id=conn.workspace_id AND connection_id=conn.id),'[]'),
  'envelopes',COALESCE((SELECT jsonb_agg(jsonb_build_object('revision',revision,'envelope',envelope,'identifiers',identifiers,'externalAccountId',verified_account_id) ORDER BY revision DESC) FROM app.channel_credential WHERE workspace_id=conn.workspace_id AND connection_id=conn.id),'[]')) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION app.mark_channel_challenge(p_id text,p_revision bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.channel_connection SET challenge_verified=true,updated_at=clock_timestamp() WHERE id=p_id AND revision=p_revision AND state<>'disconnected';
END $$;
REVOKE ALL ON FUNCTION app.lookup_channel_ingress(text),app.mark_channel_challenge(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lookup_channel_ingress(text),app.mark_channel_challenge(text,bigint) TO cadence_ingress;
