-- Keep the readiness variable distinct from channel_sender.ready.
DO $$ DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('app.commit_mail_sync(text,text,text,bigint,bigint,jsonb)'::regprocedure) INTO definition;
 IF position('SET ready=ready WHERE' IN definition)=0 THEN RAISE EXCEPTION 'SYNC_READINESS_UPGRADE_REQUIRED';END IF;
 definition:=replace(definition,'gap boolean;ready boolean;','gap boolean;ready_to_send boolean;');
 definition:=replace(definition,'ready:=complete','ready_to_send:=complete');
 definition:=replace(definition,'WHEN ready THEN','WHEN ready_to_send THEN');
 definition:=replace(definition,'SET ready=ready WHERE','SET ready=ready_to_send WHERE');
 EXECUTE definition;
END $$;
