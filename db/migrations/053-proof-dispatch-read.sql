-- read_message_dispatch uses scope_data since030. Preserve that applied definition.
DO $$ DECLARE definition text;needle text:='scope_data->''connection''->>''state''<>''ready'' OR';BEGIN
 SELECT pg_get_functiondef('app.read_message_dispatch(text,text,text,bigint)'::regprocedure) INTO definition;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'PROOF_READ_UPGRADE_REQUIRED';END IF;
 EXECUTE replace(definition,needle,'(scope_data->''connection''->>''state''<>''ready'' AND NOT app.mailbox_proof_allowed(p_ws,p_message)) OR');
END $$;
