-- Worker sees only bounded metadata through these functions, never arbitrary table writes.
CREATE FUNCTION app.notification_workspaces(batch integer) RETURNS TABLE(workspace_id text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT h.workspace_id FROM app.operation_head h LEFT JOIN app.notification_checkpoint c USING(workspace_id)
 WHERE h.sequence>coalesce(c.sequence,0) OR EXISTS(SELECT 1 FROM app.scheduled_summary s WHERE s.workspace_id=h.workspace_id AND s.next_at<=clock_timestamp())
 ORDER BY coalesce(c.sequence,0),h.workspace_id LIMIT greatest(1,least(batch,100))
$$;
CREATE FUNCTION app.notification_add(ws text,uid text,key text,kind text,title_value text,href_value text,at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE nid text;p jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.member WHERE "organizationId"=ws AND "userId"=uid AND role IN('owner','admin','operator')) THEN RETURN;END IF;
 INSERT INTO app.notification_item(workspace_id,user_id,event_key,event_type,title,href,created_at) VALUES(ws,uid,key,kind,title_value,href_value,at)
 ON CONFLICT(workspace_id,user_id,event_key) DO NOTHING RETURNING id INTO nid;
 IF nid IS NULL THEN RETURN;END IF;
 SELECT payload INTO p FROM app.notification_preference WHERE workspace_id=ws AND user_id=uid;
 IF p->>'email'='true' THEN INSERT INTO app.notification_delivery(workspace_id,user_id,item_id,channel) VALUES(ws,uid,nid,'email') ON CONFLICT DO NOTHING;END IF;
 IF p->>'whatsapp'='true' THEN INSERT INTO app.notification_delivery(workspace_id,user_id,item_id,channel,reason) VALUES(ws,uid,nid,'whatsapp','DESTINATION_PENDING') ON CONFLICT DO NOTHING;END IF;
END $$;
CREATE FUNCTION app.notification_project(ws text,batch integer) RETURNS integer
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
   kind:='integration_attention';title_value:='Uma conexão precisa de atenção';href_value:='/settings/whatsapp';
  END IF;
  IF kind IS NOT NULL AND href_value IS NOT NULL THEN
   FOR m IN SELECT a."userId" uid,p.payload FROM auth.member a LEFT JOIN app.notification_preference p ON p.workspace_id=ws AND p.user_id=a."userId" WHERE a."organizationId"=ws AND a.role IN('owner','admin','operator') LOOP
    IF m.payload IS NULL OR m.payload->'events' ? kind THEN PERFORM app.notification_add(ws,m.uid,kind||':'||e.entity_id||CASE WHEN kind='job_completed' THEN ':'||e.state ELSE '' END,kind,title_value,href_value,e.recorded_at);created:=created+1;END IF;
   END LOOP;
  END IF;
  cp:=e.sequence;
 END LOOP;
 UPDATE app.notification_checkpoint SET sequence=cp WHERE workspace_id=ws;RETURN created;
END $$;
CREATE FUNCTION app.notification_summaries(batch integer,at timestamptz) RETURNS TABLE(workspace_id text,user_id text,preferences jsonb,timezone text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT s.workspace_id,s.user_id,p.payload,coalesce(p.payload->'quiet'->>'timezone',w.payload->>'timezone','America/Sao_Paulo') FROM app.scheduled_summary s
 JOIN app.notification_preference p USING(workspace_id,user_id) JOIN auth.member m ON m."organizationId"=s.workspace_id AND m."userId"=s.user_id AND m.role IN('owner','admin','operator')
 LEFT JOIN app.workspace_preferences w ON w.workspace_id=s.workspace_id
 WHERE s.next_at<=at AND p.payload->'summary'->>'frequency' IN('daily','weekly') ORDER BY s.next_at,s.workspace_id,s.user_id LIMIT greatest(1,least(batch,100))
$$;
CREATE FUNCTION app.notification_summary(ws text,uid text,expected integer,period_from timestamptz,period_to timestamptz,next_due timestamptz,at timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p jsonb;lead_count integer;reply_count integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('summary:'||ws||':'||uid,0));
 IF NOT EXISTS(SELECT 1 FROM auth.member WHERE "organizationId"=ws AND "userId"=uid AND role IN('owner','admin','operator')) THEN RETURN false;END IF;
 SELECT payload INTO p FROM app.notification_preference WHERE workspace_id=ws AND user_id=uid AND revision=expected FOR SHARE;
 IF p IS NULL OR p->'summary'->>'frequency'='off' OR NOT EXISTS(SELECT 1 FROM app.scheduled_summary WHERE workspace_id=ws AND user_id=uid AND next_at<=at) THEN RETURN false;END IF;
 IF period_to<=period_from OR period_to-period_from>interval '8 days' OR next_due<=at THEN RAISE EXCEPTION 'NOTIFICATION_INVALID';END IF;
 PERFORM set_config('app.workspace_id',ws,true),set_config('app.user_id',uid,true);
 SELECT count(*) FILTER(WHERE metric='leads'),count(*) FILTER(WHERE metric='replies') INTO lead_count,reply_count FROM app.report_facts(period_from,period_to,NULL);
 PERFORM app.notification_add(ws,uid,'summary:'||period_from::text||':'||period_to::text,'summary','Resumo: '||lead_count||' contatos captados e '||reply_count||' respostas humanas','/reports',at);
 UPDATE app.scheduled_summary SET next_at=next_due WHERE workspace_id=ws AND user_id=uid;RETURN true;
END $$;
CREATE FUNCTION app.notification_claim(at timestamptz,lease text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d record;p jsonb;dest text;quiet jsonb;wall text;eligible boolean;
BEGIN
 FOR d IN SELECT * FROM app.notification_delivery WHERE state='pending' AND available_at<=at ORDER BY available_at,workspace_id,user_id,item_id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
  PERFORM 1 FROM auth.member WHERE "organizationId"=d.workspace_id AND "userId"=d.user_id AND role IN('owner','admin','operator') FOR SHARE;
  IF NOT FOUND THEN UPDATE app.notification_delivery SET state='cancelled',reason='MEMBERSHIP_REVOKED' WHERE workspace_id=d.workspace_id AND user_id=d.user_id AND item_id=d.item_id AND channel=d.channel;CONTINUE;END IF;
  SELECT payload INTO p FROM app.notification_preference WHERE workspace_id=d.workspace_id AND user_id=d.user_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM app.notification_item i WHERE i.workspace_id=d.workspace_id AND i.user_id=d.user_id AND i.id=d.item_id AND i.event_type='integration_attention' AND NOT EXISTS(SELECT 1 FROM app.channel_connection cc WHERE cc.workspace_id=d.workspace_id AND cc.id=split_part(i.event_key,':',2) AND cc.state<>'disconnected')) THEN
   UPDATE app.notification_delivery SET state='cancelled',reason='CHANNEL_REVOKED' WHERE workspace_id=d.workspace_id AND user_id=d.user_id AND item_id=d.item_id AND channel=d.channel;CONTINUE;
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
CREATE FUNCTION app.notification_receipt(lease text,accepted boolean,at timestamptz) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE app.notification_delivery SET state=CASE WHEN accepted THEN 'delivered' ELSE 'uncertain' END,receipt_at=at,reason=CASE WHEN accepted THEN 'ACCEPTED' ELSE 'RESULT_UNCERTAIN' END WHERE token=lease AND state='uncertain'
$$;
REVOKE ALL ON FUNCTION app.notification_workspaces(integer),app.notification_add(text,text,text,text,text,text,timestamptz),app.notification_project(text,integer),app.notification_summaries(integer,timestamptz),app.notification_summary(text,text,integer,timestamptz,timestamptz,timestamptz,timestamptz),app.notification_claim(timestamptz,text),app.notification_receipt(text,boolean,timestamptz) FROM PUBLIC,cadence_app;
GRANT EXECUTE ON FUNCTION app.notification_workspaces(integer),app.notification_project(text,integer),app.notification_summaries(integer,timestamptz),app.notification_summary(text,text,integer,timestamptz,timestamptz,timestamptz,timestamptz),app.notification_claim(timestamptz,text),app.notification_receipt(text,boolean,timestamptz) TO cadence_worker;
