-- Private, per-user notification projections. Business sources remain authoritative.
CREATE TABLE app.notification_preference(
 workspace_id text NOT NULL REFERENCES auth.organization(id),user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),payload jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE app.notification_item(
 workspace_id text NOT NULL REFERENCES auth.organization(id),user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
 id text NOT NULL DEFAULT gen_random_uuid()::text,event_key text NOT NULL,event_type text NOT NULL,title text NOT NULL,href text NOT NULL CHECK(href LIKE '/%' AND href NOT LIKE '//%'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),read_at timestamptz,PRIMARY KEY(workspace_id,user_id,id),UNIQUE(workspace_id,user_id,event_key)
);
CREATE INDEX notification_page ON app.notification_item(workspace_id,user_id,created_at DESC,id DESC);
CREATE TABLE app.notification_delivery(
 workspace_id text NOT NULL,user_id text NOT NULL,item_id text NOT NULL,channel text NOT NULL CHECK(channel IN('email','whatsapp')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','uncertain','delivered','cancelled')),available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 token text,receipt_at timestamptz,reason text,PRIMARY KEY(workspace_id,user_id,item_id,channel),
 FOREIGN KEY(workspace_id,user_id,item_id) REFERENCES app.notification_item(workspace_id,user_id,id) ON DELETE CASCADE
);
CREATE TABLE app.scheduled_summary(
 workspace_id text NOT NULL REFERENCES auth.organization(id),user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
 next_at timestamptz NOT NULL,PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE app.notification_checkpoint(workspace_id text PRIMARY KEY REFERENCES auth.organization(id),sequence bigint NOT NULL DEFAULT 0,since_at timestamptz NOT NULL DEFAULT clock_timestamp());
INSERT INTO app.notification_checkpoint(workspace_id,sequence) SELECT workspace_id,sequence FROM app.operation_head;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['notification_preference','notification_item','notification_delivery','scheduled_summary','notification_checkpoint'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
 IF t<>'notification_checkpoint' THEN EXECUTE format('CREATE POLICY own_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND user_id=current_setting(''app.user_id'',true) AND app.current_role() IS NOT NULL)',t);END IF;
END LOOP;END $$;
GRANT SELECT ON app.notification_preference,app.notification_item,app.notification_delivery,app.scheduled_summary TO cadence_app;
CREATE FUNCTION app.save_notification_preferences(expected integer,value jsonb,next_summary timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);rev integer;
BEGIN
 IF app.lock_membership() IS NULL THEN RAISE EXCEPTION 'NOTIFICATION_ACCESS';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(ws||':'||uid||':notifications',0));
 SELECT revision INTO rev FROM app.notification_preference WHERE workspace_id=ws AND user_id=uid FOR UPDATE;
 IF coalesce(rev,0)<>expected OR expected IS NULL THEN RAISE EXCEPTION 'NOTIFICATION_CONFLICT';END IF;
 -- SQL enforces the same allowlisted shape even when the HTTP service is bypassed.
 IF jsonb_typeof(value)<>'object' OR value-ARRAY['expectedRevision','events','email','whatsapp','sound','badge','quiet','summary']<>'{}'::jsonb
 OR NOT(value ?& ARRAY['events','email','whatsapp','sound','badge','quiet','summary'])
 OR jsonb_typeof(value->'events')<>'array' OR jsonb_array_length(value->'events')>9
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(value->'events')e WHERE e NOT IN('lead_reply','meeting','handoff','approval','qualified','agent_failed','job_completed','delivery_failed','integration_attention'))
 OR jsonb_typeof(value->'email')<>'boolean' OR jsonb_typeof(value->'whatsapp')<>'boolean' OR jsonb_typeof(value->'sound')<>'boolean' OR jsonb_typeof(value->'badge')<>'boolean'
 OR value->'summary'->>'frequency' NOT IN('off','daily','weekly') OR coalesce(value->'summary'->>'time','')!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
 THEN RAISE EXCEPTION 'NOTIFICATION_INVALID';END IF;
 IF value->'quiet'<>'null'::jsonb AND (jsonb_typeof(value->'quiet')<>'object' OR coalesce(value->'quiet'->>'start','')!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' OR coalesce(value->'quiet'->>'end','')!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$') THEN RAISE EXCEPTION 'NOTIFICATION_INVALID';END IF;
 IF value->'quiet'<>'null'::jsonb THEN PERFORM clock_timestamp() AT TIME ZONE(value->'quiet'->>'timezone');END IF;
 INSERT INTO app.notification_preference(workspace_id,user_id,revision,payload) VALUES(ws,uid,coalesce(rev,0)+1,value)
 ON CONFLICT(workspace_id,user_id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,updated_at=clock_timestamp() RETURNING revision INTO rev;
 IF value->'summary'->>'frequency'='off' THEN DELETE FROM app.scheduled_summary WHERE workspace_id=ws AND user_id=uid;
 ELSE
 IF next_summary IS NULL OR next_summary<clock_timestamp()-interval '1 minute' OR next_summary>clock_timestamp()+interval '8 days' THEN RAISE EXCEPTION 'NOTIFICATION_INVALID';END IF;
 INSERT INTO app.scheduled_summary VALUES(ws,uid,next_summary) ON CONFLICT(workspace_id,user_id) DO UPDATE SET next_at=EXCLUDED.next_at;END IF;
 RETURN rev;
END $$;
CREATE FUNCTION app.read_notification(item text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.lock_membership() IS NULL THEN RAISE EXCEPTION 'NOTIFICATION_ACCESS';END IF;
 UPDATE app.notification_item SET read_at=coalesce(read_at,clock_timestamp()) WHERE workspace_id=current_setting('app.workspace_id',true) AND user_id=current_setting('app.user_id',true) AND id=item;RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION app.save_notification_preferences(integer,jsonb,timestamptz),app.read_notification(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.save_notification_preferences(integer,jsonb,timestamptz),app.read_notification(text) TO cadence_app;
