-- A new human conversation may receive a service reply, without cancelling an unrelated enrollment.
-- An explicit opt-out always suppresses that email identity, including unthreaded requests.
DO $$ DECLARE definition text;needle text:=' IF NOT linked THEN RETURN NEW;END IF;';BEGIN
 SELECT pg_get_functiondef('app.apply_mail_inbound()'::regprocedure) INTO definition;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'HUMAN_WINDOW_UPGRADE_REQUIRED';END IF;
 EXECUTE replace(definition,needle,
 ' UPDATE app.channel_conversation SET last_inbound_at=GREATEST(last_inbound_at,m.occurred_at) WHERE workspace_id=NEW.workspace_id AND id=m.conversation_id;'||chr(10)||
 ' IF NOT linked AND NOT COALESCE((assessment->>''stopRequested'')::boolean,false) THEN RETURN NEW;END IF;');
END $$;
