-- SDR objectives (16/11/2026): the app keeps where each conversation stands (stage, script answers, unanswered asks, the open offer),
-- links or creates the lead from the WhatsApp number, fills only empty lead fields (different values wait as conflicts) and keeps
-- the agent's view of the lead in payload.sdrProfile. The worker reads the workspace calendar to offer real slots.
ALTER TABLE app.sdr_thread_state
 ADD COLUMN stage text NOT NULL DEFAULT 'qualifying' CHECK(stage IN('qualifying','qualified','offer','done')),
 ADD COLUMN answers jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN attempts jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN asked text CHECK(length(asked)<=40),
 ADD COLUMN offer jsonb,
 ADD COLUMN conflicts jsonb NOT NULL DEFAULT '[]';

-- Same rule as leadWhatsappPhone (src/domain/whatsapp-identity.ts): a Brazilian number saved without +55 is read as Brazilian.
CREATE FUNCTION app.lead_phone_e164(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN e IS NOT NULL AND e~'^\+[1-9][0-9]{6,14}$' THEN e END FROM (SELECT CASE
  WHEN btrim(p) LIKE '+%' THEN '+'||d WHEN d~'^[0-9]{10,11}$' THEN '+55'||d WHEN d~'^55[0-9]{10,11}$' THEN '+'||d END e
  FROM (SELECT regexp_replace(coalesce(p,''),'[^0-9]','','g') d) x) y
$$;

-- Before a turn: the conversation is tied to exactly one lead with the same number, or to a new lead in the "Agente SDR" list.
-- Two or more leads with the number: nothing is linked (a person chooses).
CREATE FUNCTION app.sdr_ensure_lead(p_ws text,p_conversation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cc app.channel_conversation;v_phone text;v_ids text[];v_list text;v_lead text;
BEGIN
 PERFORM app.sdr_act_as(p_ws);
 SELECT * INTO cc FROM app.channel_conversation WHERE workspace_id=p_ws AND id=p_conversation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 IF cc.lead_id IS NOT NULL THEN RETURN jsonb_build_object('leadId',cc.lead_id,'mode','existing');END IF;
 SELECT app.lead_phone_e164(i.phone) INTO v_phone FROM app.channel_identity i WHERE i.workspace_id=p_ws AND i.id=cc.identity_id;
 IF v_phone IS NULL THEN RETURN jsonb_build_object('leadId',NULL,'mode','ambiguous');END IF;
 SELECT array_agg(l.id ORDER BY l.id) INTO v_ids FROM app.lead l WHERE l.workspace_id=p_ws AND app.lead_phone_e164(l.payload->>'phone')=v_phone;
 IF coalesce(array_length(v_ids,1),0)>1 THEN RETURN jsonb_build_object('leadId',NULL,'mode','ambiguous');END IF;
 IF coalesce(array_length(v_ids,1),0)=1 THEN
  UPDATE app.channel_conversation SET lead_id=v_ids[1],lead_link_evidence=jsonb_build_object('actorId','sdr','evidence','mesmo número de WhatsApp','at',clock_timestamp()) WHERE workspace_id=p_ws AND id=p_conversation;
  RETURN jsonb_build_object('leadId',v_ids[1],'mode','linked');
 END IF;
 SELECT l.id INTO v_list FROM app.list l WHERE l.workspace_id=p_ws AND l.name='Agente SDR' ORDER BY l.id LIMIT 1;
 IF v_list IS NULL THEN v_list:=gen_random_uuid()::text;INSERT INTO app.list(workspace_id,id,name) VALUES(p_ws,v_list,'Agente SDR');END IF;
 v_lead:=gen_random_uuid()::text;
 INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES(p_ws,v_lead,v_list,jsonb_build_object('id',v_lead,'name',v_phone,'phone',v_phone,'source','SDR','createdBy','sdr','listId',v_list,'qualification','pending','createdAt',clock_timestamp()));
 UPDATE app.channel_conversation SET lead_id=v_lead,lead_link_evidence=jsonb_build_object('actorId','sdr','evidence','lead criado pelo Agente SDR','at',clock_timestamp()) WHERE workspace_id=p_ws AND id=p_conversation;
 RETURN jsonb_build_object('leadId',v_lead,'mode','created');
END $$;

-- The turn payload also carries where the conversation stands and whether the calendar can serve offers.
ALTER FUNCTION app.sdr_turn_payload(app.sdr_turn) RENAME TO sdr_turn_payload_v122;
CREATE FUNCTION app.sdr_turn_payload(t app.sdr_turn) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.sdr_turn_payload_v122(t)||jsonb_build_object(
  'progress',(SELECT jsonb_build_object('stage',s.stage,'answers',s.answers,'attempts',s.attempts,'asked',s.asked,'offer',s.offer) FROM app.sdr_thread_state s WHERE s.workspace_id=t.workspace_id AND s.conversation_id=t.conversation_id),
  'leadId',(SELECT cc.lead_id FROM app.channel_conversation cc WHERE cc.workspace_id=t.workspace_id AND cc.id=t.conversation_id),
  'conversationId',t.conversation_id,
  'calendarReady',EXISTS(SELECT 1 FROM app.integration_connection c WHERE c.workspace_id=t.workspace_id AND c.kind='google-calendar' AND c.state='ready' AND c.config IS NOT NULL AND c.attention IS NULL AND c.secret IS NOT NULL))
$$;

-- Same contract plus progress. Only a turn that produced a draft, a handoff or an abstention moves the conversation and the lead.
CREATE FUNCTION app.sdr_finish_turn(p_ws text,p_turn text,p_token text,p_decision text,p_text text,p_fields jsonb,p_usage jsonb,p_reason text,p_now timestamptz,p_proposal jsonb,p_memory jsonb,p_progress jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r text:=app.sdr_finish_turn(p_ws,p_turn,p_token,p_decision,p_text,p_fields,p_usage,p_reason,p_now,p_proposal,p_memory);conv text;v_row app.lead;
 c jsonb:=p_progress->'contact';v_found jsonb:='[]';k text;v text;v_key text;cur text;v_info text;
BEGIN
 IF r NOT IN('pending-approval','handed-off','abstained') OR p_progress IS NULL THEN RETURN r;END IF;
 PERFORM app.sdr_act_as(p_ws);
 SELECT conversation_id INTO conv FROM app.sdr_turn WHERE workspace_id=p_ws AND id=p_turn;
 INSERT INTO app.sdr_thread_state(workspace_id,conversation_id) VALUES(p_ws,conv) ON CONFLICT DO NOTHING;
 UPDATE app.sdr_thread_state SET stage=coalesce(p_progress->>'stage',stage),answers=coalesce(p_progress->'answers',answers),attempts=coalesce(p_progress->'attempts',attempts),
  asked=p_progress->>'asked',offer=CASE WHEN p_progress ? 'offer' THEN nullif(p_progress->'offer','null'::jsonb) ELSE offer END
  WHERE workspace_id=p_ws AND conversation_id=conv;
 SELECT l.* INTO v_row FROM app.lead l JOIN app.channel_conversation cc ON cc.workspace_id=l.workspace_id AND cc.lead_id=l.id WHERE cc.workspace_id=p_ws AND cc.id=conv FOR UPDATE OF l;
 IF NOT FOUND THEN RETURN r;END IF;
 -- Contact: empty fields are filled; a different value waits as a conflict for a person.
 IF jsonb_typeof(c)='object' THEN
  FOREACH k IN ARRAY ARRAY['email','phone','company'] LOOP
   v:=nullif(btrim(c->>k),'');v_key:=CASE k WHEN 'company' THEN 'companyName' ELSE k END;cur:=nullif(btrim(v_row.payload->>v_key),'');
   IF v IS NULL THEN CONTINUE;END IF;
   IF cur IS NULL THEN v_row.payload:=jsonb_set(v_row.payload,ARRAY[v_key],to_jsonb(v));
   ELSIF lower(cur)<>lower(v) AND NOT(k='phone' AND app.lead_phone_e164(cur)=app.lead_phone_e164(v)) THEN v_found:=v_found||jsonb_build_array(jsonb_build_object('field',v_key,'value',v,'current',cur));END IF;
  END LOOP;
 END IF;
 SELECT string_agg(e.key||': '||(e.value->>'value'),'; ' ORDER BY e.key) INTO v_info FROM jsonb_each(coalesce(p_progress->'answers','{}')) e;
 v_row.payload:=v_row.payload||jsonb_build_object('sdrProfile',jsonb_strip_nulls(jsonb_build_object(
  'personName',coalesce(nullif(btrim(c->>'name'),''),v_row.payload->'sdrProfile'->>'personName'),
  'pain',coalesce(nullif(btrim(p_progress->'profile'->>'pain'),''),v_row.payload->'sdrProfile'->>'pain'),
  'info',coalesce(v_info,v_row.payload->'sdrProfile'->>'info'),
  'plan',coalesce(nullif(btrim(p_progress->'profile'->>'plan'),''),v_row.payload->'sdrProfile'->>'plan'),
  'nextStep',coalesce(nullif(btrim(p_progress->'profile'->>'nextStep'),''),v_row.payload->'sdrProfile'->>'nextStep'),
  'status',coalesce(nullif(btrim(p_progress->>'status'),''),v_row.payload->'sdrProfile'->>'status'),
  'updatedAt',clock_timestamp())));
 UPDATE app.lead SET payload=v_row.payload WHERE workspace_id=p_ws AND id=v_row.id;
 UPDATE app.sdr_thread_state s SET conflicts=(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT DISTINCT ON(x->>'field') x FROM jsonb_array_elements(v_found||s.conflicts) x ORDER BY x->>'field') y)
  WHERE workspace_id=p_ws AND conversation_id=conv;
 RETURN r;
END $$;

-- A person applies a conflicting value the lead gave to the lead record.
CREATE FUNCTION app.sdr_apply_conflict(p_conversation text,p_field text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);s app.sdr_thread_state;item jsonb;
BEGIN
 IF app.current_role() IS NULL THEN RAISE EXCEPTION 'SDR_ACCESS';END IF;
 SELECT * INTO s FROM app.sdr_thread_state WHERE workspace_id=ws AND conversation_id=p_conversation FOR UPDATE;
 SELECT x INTO item FROM jsonb_array_elements(coalesce(s.conflicts,'[]')) x WHERE x->>'field'=p_field;
 IF item IS NULL THEN RAISE EXCEPTION 'SDR_NOT_FOUND';END IF;
 UPDATE app.lead l SET payload=jsonb_set(l.payload,ARRAY[p_field],item->'value') FROM app.channel_conversation cc WHERE cc.workspace_id=ws AND cc.id=p_conversation AND l.workspace_id=ws AND l.id=cc.lead_id;
 UPDATE app.sdr_thread_state SET conflicts=(SELECT coalesce(jsonb_agg(x),'[]') FROM jsonb_array_elements(conflicts) x WHERE x->>'field'<>p_field) WHERE workspace_id=ws AND conversation_id=p_conversation;
END $$;

-- A person's booking or cancellation moves the stage: booked → done; cancelled → qualified with no open offer.
CREATE FUNCTION app.sdr_set_stage(p_conversation text,p_stage text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 IF app.current_role() IS NULL THEN RAISE EXCEPTION 'SDR_ACCESS';END IF;
 IF p_stage NOT IN('qualified','done') THEN RAISE EXCEPTION 'SDR_STATE';END IF;
 INSERT INTO app.sdr_thread_state(workspace_id,conversation_id) VALUES(ws,p_conversation) ON CONFLICT DO NOTHING;
 UPDATE app.sdr_thread_state SET stage=p_stage,offer=CASE WHEN p_stage='qualified' THEN NULL ELSE offer END,asked=NULL WHERE workspace_id=ws AND conversation_id=p_conversation;
END $$;

-- The worker reads the calendar grant to offer real slots (same shape as calendar_access) and saves refreshed tokens.
CREATE FUNCTION app.worker_calendar_access(p_ws text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.integration_connection;
BEGIN
 SELECT * INTO r FROM app.integration_connection WHERE workspace_id=p_ws AND kind='google-calendar' AND state<>'revoked';
 IF NOT FOUND OR r.secret IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',r.id,'revision',r.revision,'state',r.state,'config',r.config,'configRevision',r.config_revision,'attention',r.attention,'secret',r.secret);
END $$;
CREATE FUNCTION app.worker_save_calendar_tokens(p_ws text,p_id text,p_revision bigint,p_secret jsonb,p_expires timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.integration_connection SET secret=p_secret,token_expires_at=p_expires
  WHERE workspace_id=p_ws AND id=p_id AND kind='google-calendar' AND revision=p_revision AND state<>'revoked' AND secret IS NOT NULL;
 RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION app.lead_phone_e164(text),app.sdr_ensure_lead(text,text),app.sdr_turn_payload_v122(app.sdr_turn),app.sdr_turn_payload(app.sdr_turn),
 app.sdr_finish_turn(text,text,text,text,text,jsonb,jsonb,text,timestamptz,jsonb,jsonb,jsonb),app.sdr_apply_conflict(text,text),app.sdr_set_stage(text,text),
 app.worker_calendar_access(text),app.worker_save_calendar_tokens(text,text,bigint,jsonb,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lead_phone_e164(text) TO cadence_app,cadence_worker;
GRANT EXECUTE ON FUNCTION app.sdr_ensure_lead(text,text),app.sdr_finish_turn(text,text,text,text,text,jsonb,jsonb,text,timestamptz,jsonb,jsonb,jsonb),
 app.worker_calendar_access(text),app.worker_save_calendar_tokens(text,text,bigint,jsonb,timestamptz) TO cadence_worker;
GRANT EXECUTE ON FUNCTION app.sdr_apply_conflict(text,text),app.sdr_set_stage(text,text) TO cadence_app;
