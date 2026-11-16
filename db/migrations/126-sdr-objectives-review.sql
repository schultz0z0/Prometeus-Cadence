-- SDR objectives review (16/11/2026):
-- 1. A Brazilian mobile saved with the ninth digit matches a WhatsApp identity without it (older numbers), and the reverse.
-- 2. A lead the agent creates for a WhatsApp contact is not billed as an import (like LinkedIn worker leads; pricing pending a user decision).
CREATE FUNCTION app.lead_phone_key(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN e~'^\+55[1-9][0-9][6-9][0-9]{7}$' THEN substr(e,1,5)||'9'||substr(e,6) ELSE e END FROM (SELECT app.lead_phone_e164(p) e) x
$$;

CREATE OR REPLACE FUNCTION app.sdr_ensure_lead(p_ws text,p_conversation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cc app.channel_conversation;v_phone text;v_key text;v_ids text[];v_list text;v_lead text;
BEGIN
 PERFORM app.sdr_act_as(p_ws);
 SELECT * INTO cc FROM app.channel_conversation WHERE workspace_id=p_ws AND id=p_conversation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 IF cc.lead_id IS NOT NULL THEN RETURN jsonb_build_object('leadId',cc.lead_id,'mode','existing');END IF;
 SELECT app.lead_phone_e164(i.phone),app.lead_phone_key(i.phone) INTO v_phone,v_key FROM app.channel_identity i WHERE i.workspace_id=p_ws AND i.id=cc.identity_id;
 IF v_phone IS NULL THEN RETURN jsonb_build_object('leadId',NULL,'mode','ambiguous');END IF;
 SELECT array_agg(l.id ORDER BY l.id) INTO v_ids FROM app.lead l WHERE l.workspace_id=p_ws AND app.lead_phone_key(l.payload->>'phone')=v_key;
 IF coalesce(array_length(v_ids,1),0)>1 THEN RETURN jsonb_build_object('leadId',NULL,'mode','ambiguous');END IF;
 IF coalesce(array_length(v_ids,1),0)=1 THEN
  UPDATE app.channel_conversation SET lead_id=v_ids[1],lead_link_evidence=jsonb_build_object('actorId','sdr','evidence','mesmo número de WhatsApp','at',clock_timestamp()) WHERE workspace_id=p_ws AND id=p_conversation;
  RETURN jsonb_build_object('leadId',v_ids[1],'mode','linked');
 END IF;
 SELECT l.id INTO v_list FROM app.list l WHERE l.workspace_id=p_ws AND l.name='Agente SDR' ORDER BY l.id LIMIT 1;
 IF v_list IS NULL THEN v_list:=gen_random_uuid()::text;INSERT INTO app.list(workspace_id,id,name) VALUES(p_ws,v_list,'Agente SDR');END IF;
 v_lead:=gen_random_uuid()::text;
 PERFORM set_config('app.sdr_lead_id',v_lead,true);
 INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES(p_ws,v_lead,v_list,jsonb_build_object('id',v_lead,'name',v_phone,'phone',v_phone,'source','SDR','createdBy','sdr','listId',v_list,'qualification','pending','createdAt',clock_timestamp()));
 PERFORM set_config('app.sdr_lead_id','',true);
 UPDATE app.channel_conversation SET lead_id=v_lead,lead_link_evidence=jsonb_build_object('actorId','sdr','evidence','lead criado pelo Agente SDR','at',clock_timestamp()) WHERE workspace_id=p_ws AND id=p_conversation;
 RETURN jsonb_build_object('leadId',v_lead,'mode','created');
END $$;

CREATE OR REPLACE FUNCTION app.billing_guard_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.prospecting_job;job text:=nullif(current_setting('app.billing_job_id',true),'');unit text:='imports';hold text;
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM app.merge_source s JOIN app.merge_record m ON m.workspace_id=s.workspace_id AND m.id=s.merge_id WHERE s.workspace_id=NEW.workspace_id AND s.lead_id=NEW.id AND s.payload=NEW.payload AND m.state='merged' AND m.id=nullif(current_setting('app.lifecycle_undo',true),'')) THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM app.enrichment_delivery d WHERE d.workspace_id=NEW.workspace_id AND d.lead_id=NEW.id AND d.payload=NEW.payload AND d.list_id=NEW.list_id) OR EXISTS(SELECT 1 FROM app.research_person_company pc WHERE pc.workspace_id=NEW.workspace_id AND pc.applied_lead_id=NEW.id AND pc.applied_payload=NEW.payload AND pc.applied_list_id=NEW.list_id) THEN RETURN NEW;END IF;
 -- 07A.2: a lead born from a proven LinkedIn acceptance (or expiry), written by the worker into that campaign's own list;
 -- LinkedIn pricing is per connected account (user decision pending).
 IF session_user='cadence_worker' AND NEW.payload->>'source'='LINKEDIN' AND EXISTS(SELECT 1 FROM app.linkedin_campaign_person lp JOIN app.linkedin_campaign lc ON lc.workspace_id=lp.workspace_id AND lc.id=lp.campaign_id
   WHERE lp.workspace_id=NEW.workspace_id AND lp.lead_id=NEW.id AND NEW.list_id IN(lc.accept_list_id,lc.other_list_id)) THEN RETURN NEW;END IF;
 -- 16/11/2026: a WhatsApp contact the SDR agent attends gets a lead written by sdr_ensure_lead; the SDR is priced per reply.
 IF session_user='cadence_worker' AND NEW.payload->>'source'='SDR' AND NEW.id=nullif(current_setting('app.sdr_lead_id',true),'') THEN RETURN NEW;END IF;
 IF job IS NOT NULL THEN
  SELECT * INTO j FROM app.prospecting_job WHERE workspace_id=NEW.workspace_id AND id=job AND actor_id=current_setting('app.user_id',true) AND lease_token=current_setting('app.billing_job_token',true) AND fence::text=current_setting('app.billing_job_fence',true) AND lease_until>clock_timestamp() AND state IN('running','waiting_provider','cancelling') AND kind='generation';
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_JOB';END IF;
  IF j.created_at<(SELECT cutover_at FROM app.billing_account WHERE workspace_id=NEW.workspace_id) THEN RETURN NEW;END IF;
  unit:=CASE WHEN j.source='APOLLO' THEN 'imports' ELSE 'extractions' END;hold:='job:'||job;
 END IF;
 PERFORM app.billing_consume('lead:'||NEW.id,unit,1,hold);RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION app.lead_phone_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lead_phone_key(text) TO cadence_app,cadence_worker;
