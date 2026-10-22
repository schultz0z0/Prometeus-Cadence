-- The constraint trigger is shared by two record shapes; access their common JSON projection.
DO $$ DECLARE definition text;needle text:='CASE WHEN TG_TABLE_NAME=''cadence_enrollment'' THEN NEW.id ELSE NEW.enrollment_id END';BEGIN
 SELECT pg_get_functiondef('app.check_enrollment_channels()'::regprocedure) INTO definition;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'ENROLLMENT_TRIGGER_UPGRADE_REQUIRED';END IF;
 EXECUTE replace(definition,needle,'COALESCE(to_jsonb(NEW)->>''enrollment_id'',to_jsonb(NEW)->>''id'')');
END $$;
