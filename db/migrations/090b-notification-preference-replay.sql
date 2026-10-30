-- Exact lost-response replay returns the committed revision without rescheduling.
CREATE OR REPLACE FUNCTION app.save_notification_preferences(expected integer,value jsonb,next_summary timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);rev integer;saved jsonb;
BEGIN
 IF app.lock_membership() IS NULL THEN RAISE EXCEPTION 'NOTIFICATION_ACCESS';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(ws||':'||uid||':notifications',0));
 SELECT revision,payload INTO rev,saved FROM app.notification_preference WHERE workspace_id=ws AND user_id=uid FOR UPDATE;
 IF expected IS NOT NULL AND rev=expected+1 AND saved=value THEN RETURN rev;END IF;
 IF coalesce(rev,0)<>expected OR expected IS NULL THEN RAISE EXCEPTION 'NOTIFICATION_CONFLICT';END IF;
 -- SQL enforces the same allowlisted shape even when the HTTP service is bypassed.
 IF jsonb_typeof(value)<>'object' OR value-ARRAY['expectedRevision','events','email','whatsapp','sound','badge','quiet','summary']<>'{}'::jsonb
 OR NOT(value ?& ARRAY['events','email','whatsapp','sound','badge','quiet','summary'])
 OR jsonb_typeof(value->'events')<>'array' OR jsonb_array_length(value->'events')>9
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(value->'events')e WHERE e NOT IN('lead_reply','meeting','handoff','approval','qualified','agent_failed','job_completed','delivery_failed','integration_attention'))
 OR jsonb_typeof(value->'email')<>'boolean' OR jsonb_typeof(value->'whatsapp')<>'boolean' OR jsonb_typeof(value->'sound')<>'boolean' OR jsonb_typeof(value->'badge')<>'boolean'
 OR value->'summary'->>'frequency' NOT IN('off','daily','weekly') OR coalesce(value->'summary'->>'time','')!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
 THEN RAISE EXCEPTION 'NOTIFICATION_INVALID';END IF;
 IF value->'quiet'<>'null'::jsonb AND (jsonb_typeof(value->'quiet')<>'object' OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=value->'quiet'->>'timezone') OR coalesce(value->'quiet'->>'start','')!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' OR coalesce(value->'quiet'->>'end','')!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$') THEN RAISE EXCEPTION 'NOTIFICATION_INVALID';END IF;
 IF value->'quiet'<>'null'::jsonb THEN PERFORM clock_timestamp() AT TIME ZONE(value->'quiet'->>'timezone');END IF;
 INSERT INTO app.notification_preference(workspace_id,user_id,revision,payload) VALUES(ws,uid,coalesce(rev,0)+1,value)
 ON CONFLICT(workspace_id,user_id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,updated_at=clock_timestamp() RETURNING revision INTO rev;
 IF value->'summary'->>'frequency'='off' THEN DELETE FROM app.scheduled_summary WHERE workspace_id=ws AND user_id=uid;
 ELSE
 IF next_summary IS NULL OR next_summary<clock_timestamp()-interval '1 minute' OR next_summary>clock_timestamp()+interval '8 days' THEN RAISE EXCEPTION 'NOTIFICATION_INVALID';END IF;
 INSERT INTO app.scheduled_summary VALUES(ws,uid,next_summary) ON CONFLICT(workspace_id,user_id) DO UPDATE SET next_at=EXCLUDED.next_at;END IF;
 RETURN rev;
END $$;
