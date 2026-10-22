DO $$ DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('app.sync_mail_refresh(text,text,text,bigint,bigint,text,jsonb,timestamptz,text)'::regprocedure) INTO definition;
 definition:=replace(definition,'sync_mail_refresh(p_ws text, p_id text,','dispatch_mail_refresh(p_ws text, p_message text,');
 definition:=replace(definition,'DECLARE scope_data jsonb;box app.email_mailbox;','DECLARE scope_data jsonb;box app.email_mailbox;p_id text;');
 definition:=replace(definition,'scope_data:=app.read_mail_sync(p_ws,p_id,p_token,p_fence);','scope_data:=app.read_message_dispatch(p_ws,p_message,p_token,p_fence);IF scope_data IS NULL OR scope_data ? ''blocker'' OR scope_data->''connection''->>''channel''<>''EMAIL'' THEN RAISE EXCEPTION ''STALE_DISPATCH_LEASE'';END IF;p_id:=scope_data->''connection''->>''id'';');
 IF position('dispatch_mail_refresh' IN definition)=0 OR position('p_id text;' IN definition)=0 THEN RAISE EXCEPTION 'REFRESH_UPGRADE_REQUIRED';END IF;
 EXECUTE definition;
END $$;
REVOKE ALL ON FUNCTION app.dispatch_mail_refresh(text,text,text,bigint,bigint,text,jsonb,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.dispatch_mail_refresh(text,text,text,bigint,bigint,text,jsonb,timestamptz,text) TO cadence_dispatcher;
