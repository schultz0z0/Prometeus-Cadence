-- The raw message row precedes MIME metadata. Only WhatsApp uses the original hooks.
DO $$ DECLARE signature text;definition text;BEGIN
 FOREACH signature IN ARRAY ARRAY['app.channel_inbound_stop_trigger()','app.channel_conversation_window_trigger()'] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
  EXECUTE replace(definition,'IF NEW.direction=''inbound''','IF NEW.channel=''WHATSAPP'' AND NEW.direction=''inbound''');
 END LOOP;
 SELECT pg_get_functiondef('app.stop_pending_channel_identity(text,text,text,text)'::regprocedure) INTO definition;
 definition:=replace(definition,'WHERE workspace_id=p_ws AND identity_id=p_identity AND state IN(''active'',''blocked'')',
 'WHERE workspace_id=p_ws AND (identity_id=p_identity OR EXISTS(SELECT 1 FROM app.cadence_enrollment_channel ec WHERE ec.workspace_id=p_ws AND ec.enrollment_id=app.cadence_enrollment.id AND ec.identity_id=p_identity)) AND state IN(''active'',''blocked'')');
 EXECUTE definition;
 SELECT pg_get_functiondef('app.commit_mail_sync(text,text,text,bigint,bigint,jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,'jsonb_build_object(''headers'',mail->''headers'',''deliveryStatus'',mail->''deliveryStatus'')','jsonb_build_object(''headers'',mail->''headers'',''deliveryStatus'',mail->''deliveryStatus'',''assessment'',mail->''assessment'')');
 definition:=replace(definition,' complete:=COALESCE',' SELECT * INTO box FROM app.email_mailbox WHERE workspace_id=p_ws AND id=p_id;'||chr(10)||' complete:=COALESCE');
 definition:=replace(definition,'ready_to_send:=complete AND NOT gap','ready_to_send:=complete AND NOT gap AND NOT box.bounce_paused');
 EXECUTE definition;
END $$;
CREATE TABLE app.email_bounce(
 workspace_id text NOT NULL,mailbox_id text NOT NULL,outbound_message_id text NOT NULL,kind text NOT NULL CHECK(kind IN('hard-bounce','soft-bounce')),source_message_id text NOT NULL,period_date date NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,outbound_message_id,kind),FOREIGN KEY(workspace_id,mailbox_id) REFERENCES app.email_mailbox(workspace_id,id),
 FOREIGN KEY(workspace_id,outbound_message_id) REFERENCES app.email_message(workspace_id,message_id),FOREIGN KEY(workspace_id,source_message_id) REFERENCES app.email_message(workspace_id,message_id)
);
ALTER TABLE app.email_bounce ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.email_bounce FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON app.email_bounce FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT ON app.email_bounce TO cadence_app;
CREATE FUNCTION app.apply_mail_inbound() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m app.channel_message;outgoing app.email_message;assessment jsonb:=NEW.classification_evidence->'assessment';kind text:=assessment->>'kind';zone text;enrollment text;linked boolean;
BEGIN
 SELECT * INTO m FROM app.channel_message WHERE workspace_id=NEW.workspace_id AND id=NEW.message_id;
 IF m.direction<>'inbound' THEN RETURN NEW;END IF;
 IF kind IN('hard-bounce','soft-bounce') THEN
  SELECT em.* INTO outgoing FROM app.email_message em JOIN app.channel_message cm ON cm.workspace_id=em.workspace_id AND cm.id=em.message_id
   WHERE em.workspace_id=NEW.workspace_id AND em.mailbox_id=NEW.mailbox_id AND em.rfc_message_id=assessment->>'correlationId' AND em.origin='app'
   AND em.to_addresses=jsonb_build_array(assessment->>'recipient') AND cm.direction='outbound' AND cm.state IN('accepted','sent','delivered','read','uncertain') ORDER BY cm.created_at DESC LIMIT 1;
  IF NOT FOUND THEN UPDATE app.email_thread SET needs_review=true WHERE workspace_id=NEW.workspace_id AND id=NEW.thread_id;RETURN NEW;END IF;
  SELECT timezone INTO zone FROM app.messaging_limits WHERE workspace_id=NEW.workspace_id;
  INSERT INTO app.email_bounce(workspace_id,mailbox_id,outbound_message_id,kind,source_message_id,period_date) VALUES(NEW.workspace_id,NEW.mailbox_id,outgoing.message_id,kind,NEW.message_id,(clock_timestamp() AT TIME ZONE COALESCE(zone,'UTC'))::date) ON CONFLICT DO NOTHING;
  IF kind='hard-bounce' THEN
   INSERT INTO app.contact_suppression(workspace_id,identity_id,scope,reason) SELECT NEW.workspace_id,cm.identity_id,'all','hard_bounce' FROM app.channel_message cm WHERE cm.workspace_id=NEW.workspace_id AND cm.id=outgoing.message_id ON CONFLICT DO NOTHING;
  ELSE
   UPDATE app.cadence_enrollment SET state='blocked',stop_reason='EMAIL_SOFT_BOUNCE' WHERE workspace_id=NEW.workspace_id AND state='active' AND id IN(SELECT enrollment_id FROM app.message_outbox WHERE workspace_id=NEW.workspace_id AND message_id=outgoing.message_id);
   UPDATE app.message_outbox SET state='blocked',blocked_code='EMAIL_SOFT_BOUNCE' WHERE workspace_id=NEW.workspace_id AND state='pending' AND enrollment_id IN(SELECT enrollment_id FROM app.message_outbox WHERE workspace_id=NEW.workspace_id AND message_id=outgoing.message_id);
  END IF;
  IF(SELECT count(DISTINCT outbound_message_id) FROM app.email_bounce WHERE workspace_id=NEW.workspace_id AND mailbox_id=NEW.mailbox_id AND period_date=(clock_timestamp() AT TIME ZONE COALESCE(zone,'UTC'))::date)>=5 THEN
   UPDATE app.email_mailbox SET bounce_paused=true,state='attention',last_error='EMAIL_BOUNCE_REVIEW_REQUIRED' WHERE workspace_id=NEW.workspace_id AND id=NEW.mailbox_id;
   UPDATE app.channel_sender SET ready=false WHERE workspace_id=NEW.workspace_id AND connection_id=NEW.mailbox_id;
  END IF;RETURN NEW;
 END IF;
 IF kind='ambiguous' THEN UPDATE app.email_thread SET needs_review=true WHERE workspace_id=NEW.workspace_id AND id=NEW.thread_id;RETURN NEW;END IF;
 IF kind IS DISTINCT FROM 'human' OR NEW.truncated THEN RETURN NEW;END IF;
 -- A provider thread id alone cannot join another From: commit_mail_sync also matches identity.
 SELECT EXISTS(SELECT 1 FROM app.email_message em JOIN app.message_outbox o ON o.workspace_id=em.workspace_id AND o.message_id=em.message_id
  WHERE em.workspace_id=NEW.workspace_id AND em.thread_id=NEW.thread_id AND em.origin='app' AND o.identity_id=m.identity_id) INTO linked;
 IF NOT linked THEN RETURN NEW;END IF;
 UPDATE app.channel_identity SET reply_epoch=reply_epoch+1,last_reply_at=clock_timestamp(),last_inbound_at=GREATEST(last_inbound_at,m.occurred_at) WHERE workspace_id=NEW.workspace_id AND id=m.identity_id;
 UPDATE app.channel_conversation SET last_inbound_at=GREATEST(last_inbound_at,m.occurred_at) WHERE workspace_id=NEW.workspace_id AND id=m.conversation_id;
 IF COALESCE((assessment->>'stopRequested')::boolean,false) THEN
  INSERT INTO app.contact_suppression(workspace_id,identity_id,scope,reason) VALUES(NEW.workspace_id,m.identity_id,'all','email_optout') ON CONFLICT DO NOTHING;
 ELSE PERFORM app.stop_pending_channel_identity(NEW.workspace_id,m.identity_id,'reply',COALESCE(m.text,''));END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.apply_mail_inbound() FROM PUBLIC;
CREATE TRIGGER mail_inbound_after_metadata AFTER INSERT ON app.email_message FOR EACH ROW EXECUTE FUNCTION app.apply_mail_inbound();

CREATE FUNCTION app.enqueue_reviewed_mail(p_message text,p_conversation text,p_send jsonb,p_proof jsonb,p_preview text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);actor text:=current_setting('app.user_id',true);role text:=app.current_role();v app.channel_conversation;t app.email_thread;s app.channel_sender;c app.channel_connection;i app.channel_identity;box app.email_mailbox;
BEGIN
 IF role IS NULL OR p_send->>'purpose'<>'service' OR p_send->>'channel'<>'EMAIL' OR pg_column_size(p_send)>131072 OR octet_length(p_preview)>65536 THEN RAISE EXCEPTION 'INVALID_MAIL_REPLY';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO v FROM app.channel_conversation WHERE workspace_id=ws AND id=p_conversation AND channel='EMAIL';
 SELECT * INTO t FROM app.email_thread WHERE workspace_id=ws AND conversation_id=p_conversation;
 SELECT * INTO s FROM app.channel_sender WHERE workspace_id=ws AND id=v.sender_id FOR UPDATE;
 SELECT * INTO c FROM app.channel_connection WHERE workspace_id=ws AND id=v.connection_id FOR UPDATE;
 SELECT * INTO i FROM app.channel_identity WHERE workspace_id=ws AND id=v.identity_id;
 SELECT * INTO box FROM app.email_mailbox WHERE workspace_id=ws AND id=c.id;
 IF v.id IS NULL OR t.needs_review OR c.state<>'ready' OR NOT s.ready OR box.bounce_paused OR v.last_inbound_at IS NULL OR c.revision<>(p_send->>'connectionRevision')::bigint OR s.revision<>(p_proof->>'senderRevision')::bigint OR p_send->>'senderId'<>s.id OR p_send->>'address'<>s.address OR p_send->>'to'<>i.external_id OR box.signature<>p_send->'content'->>'signature' OR p_send->>'rfcMessageId'<>'<'||p_message||'@'||split_part(s.address,'@',2)||'>' THEN RAISE EXCEPTION 'MAIL_REPLY_CHANGED';END IF;
 INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,channel,direction,text,purpose) VALUES(ws,p_message,c.id,s.id,i.id,v.id,'EMAIL','outbound',p_preview,'service');
 INSERT INTO app.email_message(workspace_id,message_id,mailbox_id,thread_id,rfc_message_id,in_reply_to,reference_ids,subject,from_address,to_addresses,origin,classification)
 VALUES(ws,p_message,c.id,t.id,p_send->>'rfcMessageId',p_send->'thread'->>'inReplyTo',p_send->'thread'->'references',p_send->'content'->>'subject',s.address,jsonb_build_array(i.external_id),'app','human');
 INSERT INTO app.message_outbox(workspace_id,message_id,connection_id,sender_id,identity_id,actor_id,authority_kind,prepared_send,proof)
 VALUES(ws,p_message,c.id,s.id,i.id,actor,'member',p_send-'channel'||jsonb_build_object('channel','EMAIL'),p_proof);
 RETURN p_message;
END $$;
REVOKE ALL ON FUNCTION app.enqueue_reviewed_mail(text,text,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enqueue_reviewed_mail(text,text,jsonb,jsonb,text) TO cadence_app;
