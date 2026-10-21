-- Scope finite worker batches and exclude already materialized/scheduling rows before LIMIT.
CREATE FUNCTION app.materialize_cadence_messages(p_now timestamptz,p_limit integer,p_workspace text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate record;e app.cadence_enrollment;p app.cadence_publication;conn app.channel_connection;sender app.channel_sender;person app.channel_identity;step jsonb;content jsonb;conv text;msg text;total integer:=0;actor_role text;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 100 OR p_now IS NULL THEN RAISE EXCEPTION 'INVALID_LIMIT';END IF;
 FOR candidate IN SELECT en.workspace_id,en.id FROM app.cadence_enrollment en JOIN app.cadence_publication pub ON pub.workspace_id=en.workspace_id AND pub.id=en.publication_id WHERE en.state='active' AND pub.state='active' AND en.next_at<=p_now AND NOT en.schedule_pending AND (p_workspace IS NULL OR en.workspace_id=p_workspace) AND NOT EXISTS(SELECT 1 FROM app.message_outbox o WHERE o.workspace_id=en.workspace_id AND o.enrollment_id=en.id AND o.step_index=en.next_step) ORDER BY en.next_at,en.id LIMIT p_limit LOOP
  PERFORM 1 FROM app.workspace_meta WHERE workspace_id=candidate.workspace_id FOR UPDATE;
  SELECT * INTO e FROM app.cadence_enrollment WHERE workspace_id=candidate.workspace_id AND id=candidate.id FOR UPDATE;
  SELECT * INTO p FROM app.cadence_publication WHERE workspace_id=e.workspace_id AND id=e.publication_id;
  IF e.state<>'active' OR p.state<>'active' OR e.next_at>p_now OR EXISTS(SELECT 1 FROM app.message_outbox WHERE workspace_id=e.workspace_id AND enrollment_id=e.id AND step_index=e.next_step) THEN CONTINUE;END IF;
  SELECT role INTO actor_role FROM auth.member WHERE "organizationId"=p.workspace_id AND "userId"=p.created_by;
  IF actor_role IS NULL OR actor_role NOT IN('owner','admin') THEN UPDATE app.cadence_enrollment SET state='blocked',stop_reason='AUTHORITY_REVOKED' WHERE workspace_id=e.workspace_id AND id=e.id;CONTINUE;END IF;
  SELECT * INTO conn FROM app.channel_connection WHERE workspace_id=e.workspace_id AND id=p.snapshot->'sender'->>'connectionId' FOR UPDATE;
  SELECT * INTO sender FROM app.channel_sender WHERE workspace_id=e.workspace_id AND id=p.snapshot->'sender'->>'id' FOR UPDATE;
  IF conn.state<>'ready' OR conn.revision<>(p.snapshot->>'connectionRevision')::bigint OR NOT sender.ready THEN UPDATE app.cadence_enrollment SET state='blocked',stop_reason='CONNECTION_CHANGED' WHERE workspace_id=e.workspace_id AND id=e.id;CONTINUE;END IF;
  SELECT * INTO person FROM app.channel_identity WHERE workspace_id=e.workspace_id AND id=e.identity_id FOR UPDATE;
  step:=p.snapshot->'cadence'->'steps'->e.next_step;
  IF step IS NULL THEN UPDATE app.cadence_enrollment SET state='completed' WHERE workspace_id=e.workspace_id AND id=e.id;CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM app.contact_suppression WHERE workspace_id=e.workspace_id AND identity_id=e.identity_id AND scope IN('all','campaign')) OR (person.reply_epoch>e.authorized_reply_epoch AND (COALESCE((p.snapshot->'cadence'->'settings'->>'stopOnReply')::boolean,false) OR COALESCE((step->>'stopOnReply')::boolean,false))) THEN
   UPDATE app.cadence_enrollment SET state='stopped',stop_reason='REPLY_OR_OPTOUT' WHERE workspace_id=e.workspace_id AND id=e.id;CONTINUE;
  END IF;
  content:=p.snapshot->'recipientContents'->e.lead_id->(step->>'id');IF content IS NULL OR step->>'channel'<>'WHATSAPP' THEN UPDATE app.cadence_enrollment SET state='blocked',stop_reason='CONTENT_UNAVAILABLE' WHERE workspace_id=e.workspace_id AND id=e.id;CONTINUE;END IF;
  INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id,lead_id) VALUES(e.workspace_id,gen_random_uuid()::text,conn.id,sender.id,person.id,e.lead_id) ON CONFLICT(workspace_id,sender_id,identity_id) DO NOTHING;
  SELECT id INTO conv FROM app.channel_conversation WHERE workspace_id=e.workspace_id AND sender_id=sender.id AND identity_id=person.id;
  msg:=gen_random_uuid()::text;
  INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,text,purpose) VALUES(e.workspace_id,msg,conn.id,sender.id,person.id,conv,'outbound',p.snapshot->'messagePreviews'->e.lead_id->>(step->>'id'),'campaign');
  INSERT INTO app.message_outbox(workspace_id,message_id,publication_id,enrollment_id,step_index,connection_id,sender_id,identity_id,actor_id,authority_kind,prepared_send,proof,next_at)
   VALUES(e.workspace_id,msg,p.id,e.id,e.next_step,conn.id,sender.id,person.id,p.created_by,'admin',jsonb_build_object('connectionId',conn.id,'connectionRevision',conn.revision,'senderId',sender.id,'identity',jsonb_build_object('scope',person.scope,'externalId',person.external_id,'phone',person.phone),'content',content,'purpose','campaign'),jsonb_build_object('senderRevision',sender.revision,'replyEpoch',e.authorized_reply_epoch),e.next_at);
  total:=total+1;
 END LOOP;
 RETURN total;
END $$;

REVOKE ALL ON FUNCTION app.materialize_cadence_messages(timestamptz,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.materialize_cadence_messages(timestamptz,integer,text) TO cadence_dispatcher;
CREATE OR REPLACE FUNCTION app.materialize_cadence_messages(p_now timestamptz,p_limit integer) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app.materialize_cadence_messages(p_now,p_limit,NULL); $$;
