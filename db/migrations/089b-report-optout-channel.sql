-- Preserve the attributed conversation channel in suppression drilldowns.
CREATE OR REPLACE FUNCTION app.report_facts(p_from timestamptz,p_to timestamptz,p_cadence text DEFAULT NULL)
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
  SELECT 'optouts',s.identity_id,s.at,last_touch.channel,last_touch.cadence_id,last_touch.publication_id,last_touch.step_index,s.identity_id,'identity','suppressed',last_touch.conversation_id
  FROM(SELECT cs.identity_id,min(cs.created_at) at FROM app.contact_suppression cs WHERE cs.workspace_id=ws AND cs.reason<>'hard_bounce' GROUP BY cs.identity_id)s
  LEFT JOIN LATERAL(SELECT cp.cadence_id,o.publication_id,o.step_index,m.conversation_id,m.channel FROM app.message_outbox o JOIN app.channel_message m ON m.workspace_id=o.workspace_id AND m.id=o.message_id LEFT JOIN app.cadence_publication cp ON cp.workspace_id=o.workspace_id AND cp.id=o.publication_id WHERE o.workspace_id=ws AND o.identity_id=s.identity_id AND o.accepted_at<=s.at ORDER BY o.accepted_at DESC,o.message_id DESC LIMIT 1)last_touch ON true
  WHERE s.at>=p_from AND s.at<p_to
  UNION ALL
  SELECT bucket.metric,l.id,app.report_timestamp(l.payload->>'createdAt'),NULL,p_cadence,NULL,NULL,l.id,'lead',coalesce(l.payload->>'qualification','new'),l.id FROM app.lead l CROSS JOIN LATERAL unnest(ARRAY['leads',CASE l.payload->>'qualification' WHEN 'qualified' THEN 'qualified' WHEN 'pending' THEN 'leadPending' WHEN 'warning' THEN 'leadWarning' WHEN 'disqualified' THEN 'leadDisqualified' END])bucket(metric) WHERE bucket.metric IS NOT NULL AND l.workspace_id=ws AND app.report_timestamp(l.payload->>'createdAt')>=p_from AND app.report_timestamp(l.payload->>'createdAt')<p_to AND (p_cadence IS NULL OR EXISTS(SELECT 1 FROM app.cadence_enrollment en JOIN app.cadence_publication cp ON cp.workspace_id=en.workspace_id AND cp.id=en.publication_id WHERE en.workspace_id=ws AND en.lead_id=l.id AND cp.cadence_id=p_cadence))
  UNION ALL
  SELECT 'enrolled',e.lead_id,e.created_at,NULL,e.cadence_id,e.publication_id,NULL,e.identity_id,'lead',e.state,e.lead_id FROM(SELECT DISTINCT ON(en.lead_id)en.lead_id,cp.created_at,cp.cadence_id,cp.id publication_id,en.identity_id,en.state FROM app.cadence_enrollment en JOIN app.cadence_publication cp ON cp.workspace_id=en.workspace_id AND cp.id=en.publication_id WHERE en.workspace_id=ws AND cp.created_at>=p_from AND cp.created_at<p_to AND (p_cadence IS NULL OR cp.cadence_id=p_cadence) ORDER BY en.lead_id,cp.created_at,en.id)e
  UNION ALL
  SELECT 'executions',j.id,j.created_at,NULL,NULL,NULL,NULL,NULL,'execution',j.state,j.id FROM app.prospecting_job j WHERE j.workspace_id=ws AND j.created_at>=p_from AND j.created_at<p_to AND p_cadence IS NULL
 ) SELECT x.metric,x.id,x.at,x.channel,x.cadence,x.pub,x.step,x.ident,x.kind,x.state,x.ref FROM candidates x WHERE p_cadence IS NULL OR x.cadence=p_cadence;
END $$;
