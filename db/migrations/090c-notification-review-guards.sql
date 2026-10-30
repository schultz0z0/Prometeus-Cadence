-- Forward-only review fixes; preserve checksums of already-applied migrations.
ALTER TABLE app.notification_item ADD COLUMN source_connection_id text;
ALTER TABLE app.notification_item ADD FOREIGN KEY(workspace_id,source_connection_id) REFERENCES app.channel_connection(workspace_id,id);
UPDATE app.notification_item i SET source_connection_id=cc.id FROM app.channel_connection cc WHERE i.event_type='integration_attention' AND cc.workspace_id=i.workspace_id AND cc.id=split_part(i.event_key,':',2);
UPDATE app.notification_item i SET source_connection_id=m.connection_id FROM app.channel_message m WHERE i.event_type IN('lead_reply','delivery_failed') AND m.workspace_id=i.workspace_id AND m.id=split_part(i.event_key,':',2);
CREATE FUNCTION app.notification_preferences_valid(value jsonb,expected integer) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE e jsonb;q jsonb;s jsonb;
BEGIN
 IF expected IS NULL OR expected<0 OR jsonb_typeof(value) IS DISTINCT FROM 'object'
 OR NOT(value ?& ARRAY['expectedRevision','events','email','whatsapp','sound','badge','quiet','summary'])
 OR value-ARRAY['expectedRevision','events','email','whatsapp','sound','badge','quiet','summary']<>'{}'::jsonb
 OR jsonb_typeof(value->'expectedRevision') IS DISTINCT FROM 'number' OR value->>'expectedRevision' !~ '^[0-9]+$' OR (value->>'expectedRevision')::numeric<>expected THEN RETURN false;END IF;
 IF jsonb_typeof(value->'events') IS DISTINCT FROM 'array' OR jsonb_array_length(value->'events')>9 THEN RETURN false;END IF;
 FOR e IN SELECT * FROM jsonb_array_elements(value->'events') LOOP
  IF jsonb_typeof(e)<>'string' OR e#>>'{}' NOT IN('lead_reply','meeting','handoff','approval','qualified','agent_failed','job_completed','delivery_failed','integration_attention') THEN RETURN false;END IF;
 END LOOP;
 IF (SELECT count(*)<>count(DISTINCT v) FROM jsonb_array_elements(value->'events')v) THEN RETURN false;END IF;
 IF jsonb_typeof(value->'email') IS DISTINCT FROM 'boolean' OR jsonb_typeof(value->'whatsapp') IS DISTINCT FROM 'boolean' OR jsonb_typeof(value->'sound') IS DISTINCT FROM 'boolean' OR jsonb_typeof(value->'badge') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
 s:=value->'summary';q:=value->'quiet';
 IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT(s ?& ARRAY['frequency','time']) OR s-ARRAY['frequency','time']<>'{}'::jsonb OR jsonb_typeof(s->'frequency') IS DISTINCT FROM 'string' OR s->>'frequency' NOT IN('off','daily','weekly') OR jsonb_typeof(s->'time') IS DISTINCT FROM 'string' OR s->>'time' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' THEN RETURN false;END IF;
 IF q<>'null'::jsonb THEN
  IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR NOT(q ?& ARRAY['timezone','start','end']) OR q-ARRAY['timezone','start','end']<>'{}'::jsonb OR jsonb_typeof(q->'timezone') IS DISTINCT FROM 'string' OR length(q->>'timezone')>100 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=q->>'timezone')
  OR jsonb_typeof(q->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(q->'end') IS DISTINCT FROM 'string' OR q->>'start' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' OR q->>'end' !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' THEN RETURN false;END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION app.notification_preferences_valid(jsonb,integer) FROM PUBLIC,cadence_app,cadence_worker;

-- Exact lost-response replay returns the committed revision without rescheduling.
CREATE OR REPLACE FUNCTION app.save_notification_preferences(expected integer,value jsonb,next_summary timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);rev integer;saved jsonb;
BEGIN
 IF app.lock_membership() IS NULL THEN RAISE EXCEPTION 'NOTIFICATION_ACCESS';END IF;
 IF NOT app.notification_preferences_valid(value,expected) THEN RAISE EXCEPTION 'NOTIFICATION_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(ws||':'||uid||':notifications',0));
 SELECT revision,payload INTO rev,saved FROM app.notification_preference WHERE workspace_id=ws AND user_id=uid FOR UPDATE;
 IF expected IS NOT NULL AND rev=expected+1 AND saved=value THEN RETURN rev;END IF;
 IF coalesce(rev,0)<>expected OR expected IS NULL THEN RAISE EXCEPTION 'NOTIFICATION_CONFLICT';END IF;
 INSERT INTO app.notification_preference(workspace_id,user_id,revision,payload) VALUES(ws,uid,coalesce(rev,0)+1,value)
 ON CONFLICT(workspace_id,user_id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,updated_at=clock_timestamp() RETURNING revision INTO rev;
 IF value->'summary'->>'frequency'='off' THEN DELETE FROM app.scheduled_summary WHERE workspace_id=ws AND user_id=uid;
 ELSE
 IF next_summary IS NULL OR next_summary<clock_timestamp()-interval '1 minute' OR next_summary>clock_timestamp()+interval '8 days' THEN RAISE EXCEPTION 'NOTIFICATION_INVALID';END IF;
 INSERT INTO app.scheduled_summary VALUES(ws,uid,next_summary) ON CONFLICT(workspace_id,user_id) DO UPDATE SET next_at=EXCLUDED.next_at;END IF;
 RETURN rev;
END $$;

CREATE OR REPLACE FUNCTION app.notification_add(ws text,uid text,key text,kind text,title_value text,href_value text,at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE nid text;p jsonb;source_id text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.member WHERE "organizationId"=ws AND "userId"=uid AND role IN('owner','admin','operator')) THEN RETURN;END IF;
 IF kind='integration_attention' THEN SELECT id INTO source_id FROM app.channel_connection WHERE workspace_id=ws AND id=split_part(key,':',2);
 ELSIF kind IN('lead_reply','delivery_failed') THEN SELECT connection_id INTO source_id FROM app.channel_message WHERE workspace_id=ws AND id=split_part(key,':',2);END IF;
 IF kind IN('integration_attention','lead_reply','delivery_failed') AND source_id IS NULL THEN RETURN;END IF;
 INSERT INTO app.notification_item(workspace_id,user_id,event_key,event_type,title,href,created_at,source_connection_id) VALUES(ws,uid,key,kind,title_value,href_value,at,source_id)
 ON CONFLICT(workspace_id,user_id,event_key) DO NOTHING RETURNING id INTO nid;
 IF nid IS NULL THEN RETURN;END IF;
 SELECT payload INTO p FROM app.notification_preference WHERE workspace_id=ws AND user_id=uid;
 IF p->>'email'='true' THEN INSERT INTO app.notification_delivery(workspace_id,user_id,item_id,channel) VALUES(ws,uid,nid,'email') ON CONFLICT DO NOTHING;END IF;
 IF p->>'whatsapp'='true' THEN INSERT INTO app.notification_delivery(workspace_id,user_id,item_id,channel,reason) VALUES(ws,uid,nid,'whatsapp','DESTINATION_PENDING') ON CONFLICT DO NOTHING;END IF;
END $$;
CREATE OR REPLACE FUNCTION app.notification_project(ws text,batch integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cp bigint;e record;m record;kind text;title_value text;href_value text;created integer:=0;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('notifications:'||ws,0)) THEN RETURN 0;END IF;
 INSERT INTO app.notification_checkpoint(workspace_id,since_at) VALUES(ws,'epoch') ON CONFLICT DO NOTHING;
 SELECT sequence INTO cp FROM app.notification_checkpoint WHERE workspace_id=ws FOR UPDATE;
 FOR e IN SELECT * FROM app.operation_event WHERE workspace_id=ws AND sequence>cp ORDER BY sequence LIMIT greatest(1,least(batch,100)) LOOP
  kind:=NULL;
  IF e.kind='message' AND EXISTS(SELECT 1 FROM app.channel_message cm LEFT JOIN app.email_message em ON em.workspace_id=cm.workspace_id AND em.message_id=cm.id WHERE cm.workspace_id=ws AND cm.id=e.entity_id AND cm.direction='inbound' AND(cm.channel='WHATSAPP' OR em.classification='human' AND NOT coalesce(em.truncated,false))) THEN
   kind:='lead_reply';title_value:='Um contato respondeu';SELECT CASE channel WHEN 'EMAIL' THEN '/messages/email' ELSE '/messages/whatsapp' END INTO href_value FROM app.channel_message WHERE workspace_id=ws AND id=e.entity_id;
  ELSIF e.kind='job' AND e.state IN('completed','partial','failed') THEN
   kind:='job_completed';title_value:=CASE e.state WHEN 'completed' THEN 'Execução concluída' WHEN 'partial' THEN 'Execução concluída com pendências' ELSE 'Execução precisa de atenção' END;href_value:='/executions/'||e.entity_id;
  ELSIF e.kind='outbox' AND e.state='failed' THEN
   kind:='delivery_failed';title_value:='Uma mensagem não foi enviada';SELECT CASE cm.channel WHEN 'EMAIL' THEN '/messages/email' ELSE '/messages/whatsapp' END INTO href_value FROM app.channel_message cm WHERE cm.workspace_id=ws AND cm.id=e.entity_id;
  ELSIF e.kind='channel' AND e.state IN('attention','expired') AND EXISTS(SELECT 1 FROM app.channel_connection cc WHERE cc.workspace_id=ws AND cc.id=e.entity_id AND cc.state=e.state) THEN
   kind:='integration_attention';title_value:='Uma conexão precisa de atenção';SELECT CASE channel WHEN 'EMAIL' THEN '/settings/email' ELSE '/settings/whatsapp' END INTO href_value FROM app.channel_connection WHERE workspace_id=ws AND id=e.entity_id;
   -- Revision/freshness changes during one incident are not new outages.
   IF coalesce((SELECT o.state FROM app.operation_event o WHERE o.workspace_id=ws AND o.kind='channel' AND o.entity_id=e.entity_id AND o.sequence<e.sequence ORDER BY o.sequence DESC LIMIT 1),'') IN('attention','expired')
    OR EXISTS(SELECT 1 FROM app.operation_event o WHERE o.workspace_id=ws AND o.kind='channel' AND o.entity_id=e.entity_id AND o.sequence>e.sequence AND o.state NOT IN('attention','expired')) THEN kind:=NULL;END IF;
  END IF;
  IF kind IS NOT NULL AND href_value IS NOT NULL THEN
   FOR m IN SELECT a."userId" uid,p.payload FROM auth.member a LEFT JOIN app.notification_preference p ON p.workspace_id=ws AND p.user_id=a."userId" WHERE a."organizationId"=ws AND a.role IN('owner','admin','operator') LOOP
    IF m.payload IS NULL OR m.payload->'events' ? kind THEN PERFORM app.notification_add(ws,m.uid,kind||':'||e.entity_id||CASE WHEN kind='job_completed' THEN ':'||e.state WHEN kind='integration_attention' THEN ':'||e.sequence::text ELSE '' END,kind,title_value,href_value,e.recorded_at);created:=created+1;END IF;
   END LOOP;
  END IF;
  cp:=e.sequence;
 END LOOP;
 UPDATE app.notification_checkpoint SET sequence=cp WHERE workspace_id=ws;RETURN created;
END $$;
CREATE OR REPLACE FUNCTION app.notification_claim(at timestamptz,lease text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d record;p jsonb;dest text;quiet jsonb;wall text;eligible boolean;
BEGIN
 FOR d IN SELECT * FROM app.notification_delivery WHERE state='pending' AND available_at<=at ORDER BY available_at,workspace_id,user_id,item_id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
  PERFORM 1 FROM auth.member WHERE "organizationId"=d.workspace_id AND "userId"=d.user_id AND role IN('owner','admin','operator') FOR SHARE;
  IF NOT FOUND THEN UPDATE app.notification_delivery SET state='cancelled',reason='MEMBERSHIP_REVOKED' WHERE workspace_id=d.workspace_id AND user_id=d.user_id AND item_id=d.item_id AND channel=d.channel;CONTINUE;END IF;
  SELECT payload INTO p FROM app.notification_preference WHERE workspace_id=d.workspace_id AND user_id=d.user_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM app.notification_item i WHERE i.workspace_id=d.workspace_id AND i.user_id=d.user_id AND i.id=d.item_id AND i.event_type IN('integration_attention','lead_reply','delivery_failed')) THEN
   -- Lock the authoritative source until the claim commits, serializing revocation.
   PERFORM 1 FROM app.channel_connection cc JOIN app.notification_item i ON i.workspace_id=cc.workspace_id AND i.source_connection_id=cc.id
    WHERE i.workspace_id=d.workspace_id AND i.user_id=d.user_id AND i.id=d.item_id AND cc.state<>'disconnected' AND cc.archived_at IS NULL FOR SHARE OF cc;
   IF NOT FOUND THEN UPDATE app.notification_delivery SET state='cancelled',reason='CHANNEL_REVOKED' WHERE workspace_id=d.workspace_id AND user_id=d.user_id AND item_id=d.item_id AND channel=d.channel;CONTINUE;END IF;
  END IF;
  SELECT p IS NOT NULL AND p->>d.channel='true' AND (i.event_type='summary' AND p->'summary'->>'frequency'<>'off' OR p->'events' ? i.event_type) INTO eligible FROM app.notification_item i WHERE i.workspace_id=d.workspace_id AND i.user_id=d.user_id AND i.id=d.item_id;
  IF eligible IS DISTINCT FROM true THEN UPDATE app.notification_delivery SET state='cancelled',reason='PREFERENCE_CHANGED' WHERE workspace_id=d.workspace_id AND user_id=d.user_id AND item_id=d.item_id AND channel=d.channel;CONTINUE;END IF;
  quiet:=p->'quiet';wall:=to_char(at AT TIME ZONE(quiet->>'timezone'),'HH24:MI');
  IF quiet<>'null'::jsonb AND quiet->>'start'<>quiet->>'end' AND(CASE WHEN quiet->>'start'<quiet->>'end' THEN wall>=quiet->>'start' AND wall<quiet->>'end' ELSE wall>=quiet->>'start' OR wall<quiet->>'end' END) THEN
   UPDATE app.notification_delivery SET available_at=at+interval '1 minute',reason='QUIET_WINDOW' WHERE workspace_id=d.workspace_id AND user_id=d.user_id AND item_id=d.item_id AND channel=d.channel;CONTINUE;
  END IF;
  SELECT email INTO dest FROM auth."user" WHERE id=d.user_id AND "emailVerified"=true FOR SHARE;
  IF d.channel<>'email' OR dest IS NULL THEN UPDATE app.notification_delivery SET available_at=at+interval '1 hour',reason='DESTINATION_PENDING' WHERE workspace_id=d.workspace_id AND user_id=d.user_id AND item_id=d.item_id AND channel=d.channel;CONTINUE;END IF;
  UPDATE app.notification_delivery SET state='uncertain',token=lease,reason='TRANSMISSION_STARTED' WHERE workspace_id=d.workspace_id AND user_id=d.user_id AND item_id=d.item_id AND channel=d.channel;
  RETURN(SELECT jsonb_build_object('workspaceId',d.workspace_id,'userId',d.user_id,'itemId',d.item_id,'channel',d.channel,'to',dest,'title',i.title,'href',i.href) FROM app.notification_item i WHERE i.workspace_id=d.workspace_id AND i.user_id=d.user_id AND i.id=d.item_id);
 END LOOP;RETURN NULL;
END $$;
DROP FUNCTION app.notification_summaries(integer,timestamptz);
CREATE FUNCTION app.notification_summaries(batch integer,at timestamptz) RETURNS TABLE(workspace_id text,user_id text,revision integer,preferences jsonb,timezone text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT s.workspace_id,s.user_id,p.revision,p.payload,coalesce(p.payload->'quiet'->>'timezone',w.payload->>'timezone','America/Sao_Paulo') FROM app.scheduled_summary s
 JOIN app.notification_preference p USING(workspace_id,user_id) JOIN auth.member m ON m."organizationId"=s.workspace_id AND m."userId"=s.user_id AND m.role IN('owner','admin','operator')
 LEFT JOIN app.workspace_preferences w ON w.workspace_id=s.workspace_id
 WHERE s.next_at<=at AND p.payload->'summary'->>'frequency' IN('daily','weekly') ORDER BY s.next_at,s.workspace_id,s.user_id LIMIT greatest(1,least(batch,100))
$$;
CREATE FUNCTION app.notification_defer_summary(ws text,uid text,expected integer,at timestamptz) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE app.scheduled_summary s SET next_at=at+interval '1 hour' WHERE s.workspace_id=ws AND s.user_id=uid AND s.next_at<=at AND EXISTS(SELECT 1 FROM app.notification_preference p WHERE p.workspace_id=ws AND p.user_id=uid AND p.revision=expected)
$$;
REVOKE ALL ON FUNCTION app.notification_summaries(integer,timestamptz),app.notification_defer_summary(text,text,integer,timestamptz) FROM PUBLIC,cadence_app;
GRANT EXECUTE ON FUNCTION app.notification_summaries(integer,timestamptz),app.notification_defer_summary(text,text,integer,timestamptz) TO cadence_worker;
