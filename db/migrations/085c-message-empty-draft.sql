-- Legacy capacity/accounting rows can have no authored steps yet.
-- Preserve their draft/capacity behavior while snapshotting an empty content array.
DO $$ DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('app.snapshot_cadence_content()'::regprocedure) INTO definition;
 IF position('NEW.payload->''steps''' IN definition)=0 THEN RAISE EXCEPTION 'AUTHORING_EMPTY_DRAFT_CONTRACT_CHANGED';END IF;
 definition:=replace(definition,'NEW.payload->''steps''','COALESCE(NEW.payload->''steps'',''[]''::jsonb)');
 definition:=replace(definition,'OLD.payload->''steps''','COALESCE(OLD.payload->''steps'',''[]''::jsonb)');
 EXECUTE definition;
END $$;
