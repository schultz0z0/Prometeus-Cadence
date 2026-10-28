CREATE OR REPLACE FUNCTION app.guard_retired_message_file() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.state='deleted' AND NEW.state<>'deleted' THEN RAISE EXCEPTION 'AUTHORING_FILE_RETIRED';END IF;
 IF OLD.state IN('ready','rejected') AND NEW.state NOT IN(OLD.state,'deleted') THEN RAISE EXCEPTION 'AUTHORING_FILE_STATE_FINAL';END IF;RETURN NEW;
END $$;
