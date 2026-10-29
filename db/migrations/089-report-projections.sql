-- Rebuildable technical projections only. Business records remain authoritative.
CREATE TABLE app.report_source_head(workspace_id text PRIMARY KEY REFERENCES auth.organization(id),revision bigint NOT NULL DEFAULT 0);
CREATE TABLE app.report_projection_checkpoint(
 workspace_id text NOT NULL REFERENCES auth.organization(id),projection_version text NOT NULL,period text NOT NULL,
 from_at timestamptz NOT NULL,to_at timestamptz NOT NULL,timezone text NOT NULL,cadence_id text,
 source_revision bigint NOT NULL,as_of timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,projection_version,period),CHECK(to_at>from_at AND to_at-from_at<=interval '93 days')
);
CREATE TABLE app.report_daily_projection(
 workspace_id text NOT NULL,projection_version text NOT NULL,period text NOT NULL,key text NOT NULL,date date,values jsonb NOT NULL,
 PRIMARY KEY(workspace_id,projection_version,period,key),
 FOREIGN KEY(workspace_id,projection_version,period) REFERENCES app.report_projection_checkpoint(workspace_id,projection_version,period) ON DELETE CASCADE,
 CHECK(length(key)<=500 AND jsonb_typeof(values)='object' AND pg_column_size(values)<=8192)
);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['report_source_head','report_projection_checkpoint','report_daily_projection'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
 EXECUTE format('CREATE POLICY report_read ON app.%I FOR SELECT TO cadence_app USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
 EXECUTE format('GRANT SELECT ON app.%I TO cadence_app',t);
END LOOP;END $$;
CREATE FUNCTION app.report_timestamp(p_value text) RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN IF p_value IS NULL OR p_value !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN RETURN NULL;END IF;RETURN p_value::timestamptz;EXCEPTION WHEN OTHERS THEN RETURN NULL;END $$;
REVOKE ALL ON FUNCTION app.report_timestamp(text) FROM PUBLIC;
CREATE INDEX report_lead_period ON app.lead(workspace_id,app.report_timestamp(payload->>'createdAt'),id);
CREATE INDEX report_outbox_conversation_acceptance ON app.message_outbox(workspace_id,identity_id,accepted_at DESC) WHERE accepted_at IS NOT NULL;
CREATE INDEX report_message_conversation_period ON app.channel_message(workspace_id,conversation_id,metric_at DESC,id);

CREATE FUNCTION app.report_facts(p_from timestamptz,p_to timestamptz,p_cadence text DEFAULT NULL)
RETURNS TABLE(metric text,id text,happened_at timestamptz,channel text,cadence_id text,publication_id text,step_index integer,identity_id text,kind text,state text,ref_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 IF app.current_role() IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>interval '93 days' THEN RAISE EXCEPTION 'REPORT_SCOPE_INVALID';END IF;
 IF p_cadence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.cadence c WHERE c.workspace_id=ws AND c.id=p_cadence) THEN RAISE EXCEPTION 'REPORT_CADENCE_NOT_FOUND';END IF;
 RETURN QUERY
 WITH messages AS MATERIALIZED(
  SELECT m.*,o.publication_id AS own_pub,o.step_index AS own_step,o.accepted_at AS provider_accepted,cp.cadence_id AS own_cadence,em.classification,em.truncated
  FROM app.channel_message m LEFT JOIN app.message_outbox o ON o.workspace_id=m.workspace_id AND o.message_id=m.id
  LEFT JOIN app.cadence_publication cp ON cp.workspace_id=o.workspace_id AND cp.id=o.publication_id
  LEFT JOIN app.email_message em ON em.workspace_id=m.workspace_id AND em.message_id=m.id
  WHERE m.workspace_id=ws AND m.metric_at>=p_from AND m.metric_at<p_to
 ), candidates AS(
  SELECT 'sent'::text metric,m.id,m.provider_accepted at,m.channel,m.own_cadence cadence,m.own_pub pub,m.own_step step,m.identity_id ident,'message'::text kind,m.state,m.conversation_id ref
  FROM messages m WHERE m.direction='outbound' AND m.provider_accepted>=p_from AND m.provider_accepted<p_to
  UNION ALL
  SELECT CASE m.state WHEN 'failed' THEN 'failed' WHEN 'uncertain' THEN 'uncertain' ELSE 'pending' END,m.id,m.metric_at,m.channel,m.own_cadence,m.own_pub,m.own_step,m.identity_id,'message',m.state,m.conversation_id
  FROM messages m WHERE m.direction='outbound' AND m.state IN('failed','uncertain','pending','dispatching')
  UNION ALL
  SELECT 'replies',m.id,m.metric_at,m.channel,last_touch.cadence_id,last_touch.publication_id,last_touch.step_index,m.identity_id,'message',m.state,m.conversation_id
  FROM messages m LEFT JOIN LATERAL(
   SELECT cp.cadence_id,o.publication_id,o.step_index FROM app.channel_message parent JOIN app.message_outbox o ON o.workspace_id=parent.workspace_id AND o.message_id=parent.id JOIN app.cadence_publication cp ON cp.workspace_id=o.workspace_id AND cp.id=o.publication_id
   WHERE parent.workspace_id=ws AND parent.conversation_id=m.conversation_id AND o.accepted_at<=m.metric_at ORDER BY o.accepted_at DESC,o.message_id DESC LIMIT 1
  )last_touch ON true
  WHERE m.direction='inbound' AND (m.channel='WHATSAPP' OR m.classification='human' AND NOT coalesce(m.truncated,false))
  UNION ALL
  SELECT 'bounces',b.outbound_message_id,b.at,'EMAIL',cp.cadence_id,o.publication_id,o.step_index,m.identity_id,'message','bounced',m.conversation_id
  FROM(SELECT eb.outbound_message_id,min(eb.created_at) at FROM app.email_bounce eb WHERE eb.workspace_id=ws GROUP BY eb.outbound_message_id)b
  JOIN app.channel_message m ON m.workspace_id=ws AND m.id=b.outbound_message_id LEFT JOIN app.message_outbox o ON o.workspace_id=ws AND o.message_id=m.id LEFT JOIN app.cadence_publication cp ON cp.workspace_id=ws AND cp.id=o.publication_id WHERE b.at>=p_from AND b.at<p_to
  UNION ALL
  SELECT 'optouts',s.identity_id,s.at,NULL,last_touch.cadence_id,last_touch.publication_id,last_touch.step_index,s.identity_id,'identity','suppressed',last_touch.conversation_id
  FROM(SELECT cs.identity_id,min(cs.created_at) at FROM app.contact_suppression cs WHERE cs.workspace_id=ws AND cs.reason<>'hard_bounce' GROUP BY cs.identity_id)s
  LEFT JOIN LATERAL(SELECT cp.cadence_id,o.publication_id,o.step_index,m.conversation_id FROM app.message_outbox o JOIN app.channel_message m ON m.workspace_id=o.workspace_id AND m.id=o.message_id LEFT JOIN app.cadence_publication cp ON cp.workspace_id=o.workspace_id AND cp.id=o.publication_id WHERE o.workspace_id=ws AND o.identity_id=s.identity_id AND o.accepted_at<=s.at ORDER BY o.accepted_at DESC,o.message_id DESC LIMIT 1)last_touch ON true
  WHERE s.at>=p_from AND s.at<p_to
  UNION ALL
  SELECT 'leads',l.id,app.report_timestamp(l.payload->>'createdAt'),NULL,p_cadence,NULL,NULL,l.id,'lead',coalesce(l.payload->>'qualification','new'),l.id FROM app.lead l WHERE l.workspace_id=ws AND app.report_timestamp(l.payload->>'createdAt')>=p_from AND app.report_timestamp(l.payload->>'createdAt')<p_to AND (p_cadence IS NULL OR EXISTS(SELECT 1 FROM app.cadence_enrollment en JOIN app.cadence_publication cp ON cp.workspace_id=en.workspace_id AND cp.id=en.publication_id WHERE en.workspace_id=ws AND en.lead_id=l.id AND cp.cadence_id=p_cadence))
  UNION ALL
  SELECT 'qualified',l.id,app.report_timestamp(l.payload->>'createdAt'),NULL,p_cadence,NULL,NULL,l.id,'lead','qualified',l.id FROM app.lead l WHERE l.workspace_id=ws AND l.payload->>'qualification'='qualified' AND app.report_timestamp(l.payload->>'createdAt')>=p_from AND app.report_timestamp(l.payload->>'createdAt')<p_to AND (p_cadence IS NULL OR EXISTS(SELECT 1 FROM app.cadence_enrollment en JOIN app.cadence_publication cp ON cp.workspace_id=en.workspace_id AND cp.id=en.publication_id WHERE en.workspace_id=ws AND en.lead_id=l.id AND cp.cadence_id=p_cadence))
  UNION ALL
  SELECT 'enrolled',e.lead_id,e.created_at,NULL,e.cadence_id,e.publication_id,NULL,e.identity_id,'lead',e.state,e.lead_id FROM(SELECT DISTINCT ON(en.lead_id)en.lead_id,cp.created_at,cp.cadence_id,cp.id publication_id,en.identity_id,en.state FROM app.cadence_enrollment en JOIN app.cadence_publication cp ON cp.workspace_id=en.workspace_id AND cp.id=en.publication_id WHERE en.workspace_id=ws AND cp.created_at>=p_from AND cp.created_at<p_to AND (p_cadence IS NULL OR cp.cadence_id=p_cadence) ORDER BY en.lead_id,cp.created_at,en.id)e
  UNION ALL
  SELECT 'executions',j.id,j.created_at,NULL,NULL,NULL,NULL,NULL,'execution',j.state,j.id FROM app.prospecting_job j WHERE j.workspace_id=ws AND j.created_at>=p_from AND j.created_at<p_to AND p_cadence IS NULL
 ) SELECT x.metric,x.id,x.at,x.channel,x.cadence,x.pub,x.step,x.ident,x.kind,x.state,x.ref FROM candidates x WHERE p_cadence IS NULL OR x.cadence=p_cadence;
END $$;
REVOKE ALL ON FUNCTION app.report_facts(timestamptz,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.report_facts(timestamptz,timestamptz,text) TO cadence_app;

CREATE FUNCTION app.ensure_report_projection(p_from timestamptz,p_to timestamptz,p_zone text,p_cadence text DEFAULT NULL,p_force boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);rev bigint;cache_key text;prior app.report_projection_checkpoint;role text:=app.current_role();
BEGIN
 IF role IS NULL OR p_force AND role NOT IN('owner','admin') OR p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>interval '93 days' OR p_zone IS NULL OR length(p_zone)>100 THEN RAISE EXCEPTION 'REPORT_SCOPE_INVALID';END IF;
 PERFORM p_from AT TIME ZONE p_zone;
 IF p_cadence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.cadence WHERE workspace_id=ws AND id=p_cadence) THEN RAISE EXCEPTION 'REPORT_CADENCE_NOT_FOUND';END IF;
 INSERT INTO app.report_source_head(workspace_id) VALUES(ws) ON CONFLICT DO NOTHING;
 SELECT revision INTO rev FROM app.report_source_head WHERE workspace_id=ws FOR SHARE;
 cache_key:=md5(extract(epoch FROM p_from)::text||'/'||extract(epoch FROM p_to)::text||'/'||p_zone||'/'||coalesce(p_cadence,''));
 SELECT * INTO prior FROM app.report_projection_checkpoint WHERE workspace_id=ws AND projection_version='reports-v1' AND period=cache_key;
 IF FOUND AND prior.source_revision=rev AND NOT p_force THEN RETURN jsonb_build_object('period',cache_key,'revision',rev,'asOf',prior.as_of);END IF;
 INSERT INTO app.report_projection_checkpoint(workspace_id,projection_version,period,from_at,to_at,timezone,cadence_id,source_revision) VALUES(ws,'reports-v1',cache_key,p_from,p_to,p_zone,p_cadence,rev)
 ON CONFLICT(workspace_id,projection_version,period) DO UPDATE SET source_revision=EXCLUDED.source_revision,as_of=clock_timestamp();
 DELETE FROM app.report_daily_projection WHERE workspace_id=ws AND projection_version='reports-v1' AND period=cache_key;
 INSERT INTO app.report_daily_projection(workspace_id,projection_version,period,key,date,values)
 WITH facts AS MATERIALIZED(SELECT f.*,(f.happened_at AT TIME ZONE p_zone)::date local_date FROM app.report_facts(p_from,p_to,p_cadence)f), tagged AS(
  SELECT f.*,f.metric='replies' AND EXISTS(SELECT 1 FROM facts sent WHERE sent.metric='sent' AND sent.identity_id=f.identity_id AND sent.cadence_id IS NOT DISTINCT FROM f.cadence_id) AS recipient_reply FROM facts f
 ) SELECT ws,'reports-v1',cache_key,
 CASE WHEN grouping(local_date)=0 THEN 'series:'||local_date::text WHEN grouping(step_index)=0 THEN 'step:'||coalesce(publication_id,'')||':'||coalesce(step_index::text,'') WHEN grouping(cadence_id)=0 THEN 'cadence:'||coalesce(cadence_id,'') ELSE 'totals' END,
 CASE WHEN grouping(local_date)=0 THEN local_date ELSE NULL END,
 jsonb_build_object('sent',count(*) FILTER(WHERE metric='sent'),'email',count(*) FILTER(WHERE metric='sent' AND channel='EMAIL'),'whatsapp',count(*) FILTER(WHERE metric='sent' AND channel='WHATSAPP'),'replies',count(*) FILTER(WHERE metric='replies'),'failed',count(*) FILTER(WHERE metric='failed'),'pending',count(*) FILTER(WHERE metric='pending'),'uncertain',count(*) FILTER(WHERE metric='uncertain'),'bounces',count(*) FILTER(WHERE metric='bounces'),'optouts',count(*) FILTER(WHERE metric='optouts'),'leads',count(*) FILTER(WHERE metric='leads'),'qualified',count(*) FILTER(WHERE metric='qualified'),'enrolled',count(*) FILTER(WHERE metric='enrolled'),'executions',count(*) FILTER(WHERE metric='executions'),'recipients',count(DISTINCT identity_id) FILTER(WHERE metric='sent'),'responders',count(DISTINCT identity_id) FILTER(WHERE recipient_reply),'opens',NULL,'clicks',NULL,'connected',NULL,'qualificationHistory',NULL,'cadenceId',cadence_id,'publicationId',publication_id,'stepIndex',step_index)
 FROM tagged GROUP BY GROUPING SETS((),(local_date),(cadence_id),(cadence_id,publication_id,step_index));
 -- Keep a bounded cache, not an unbounded second reporting history.
 DELETE FROM app.report_projection_checkpoint WHERE workspace_id=ws AND (projection_version,period) IN(SELECT projection_version,period FROM app.report_projection_checkpoint WHERE workspace_id=ws ORDER BY as_of DESC OFFSET 128);
 RETURN jsonb_build_object('period',cache_key,'revision',rev,'asOf',(SELECT as_of FROM app.report_projection_checkpoint WHERE workspace_id=ws AND projection_version='reports-v1' AND period=cache_key));
END $$;
REVOKE ALL ON FUNCTION app.ensure_report_projection(timestamptz,timestamptz,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ensure_report_projection(timestamptz,timestamptz,text,text,boolean) TO cadence_app;
CREATE INDEX report_checkpoint_recent ON app.report_projection_checkpoint(workspace_id,as_of DESC);
CREATE FUNCTION app.invalidate_report_projection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text;BEGIN
 ws:=CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
 INSERT INTO app.report_source_head(workspace_id,revision) VALUES(ws,1) ON CONFLICT(workspace_id) DO UPDATE SET revision=app.report_source_head.revision+1;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION app.invalidate_report_projection() FROM PUBLIC;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['lead','cadence','cadence_publication','cadence_enrollment','channel_message','message_outbox','email_message','email_bounce','contact_suppression','prospecting_job'] LOOP
 EXECUTE format('CREATE TRIGGER report_source_change AFTER INSERT OR UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.invalidate_report_projection()',t);
END LOOP;END $$;
