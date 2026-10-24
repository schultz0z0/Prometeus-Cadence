-- Guards run where rows are actually inserted, so API, jobs and direct app SQL agree.
CREATE FUNCTION app.billing_guard_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') THEN RETURN NEW;END IF;
 PERFORM app.billing_require_execution(NEW.workspace_id);
 IF NEW.kind='generation' THEN PERFORM app.billing_reserve('job:'||NEW.id,CASE WHEN NEW.source='APOLLO' THEN 'imports' ELSE 'extractions' END,(NEW.input->>'limit')::integer);END IF;RETURN NEW;
END $$;
CREATE TRIGGER billing_guard_job AFTER INSERT ON app.prospecting_job FOR EACH ROW EXECUTE FUNCTION app.billing_guard_job();
CREATE FUNCTION app.billing_guard_outbox() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN IF session_user IN('cadence_app','cadence_worker') THEN PERFORM app.billing_require_execution(NEW.workspace_id);END IF;RETURN NEW;END $$;
CREATE TRIGGER billing_guard_outbox BEFORE INSERT ON app.message_outbox FOR EACH ROW EXECUTE FUNCTION app.billing_guard_outbox();
CREATE FUNCTION app.billing_guard_lead() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.prospecting_job;job text:=nullif(current_setting('app.billing_job_id',true),'');unit text:='imports';hold text;
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') THEN RETURN NEW;END IF;
 IF job IS NOT NULL THEN
  SELECT * INTO j FROM app.prospecting_job WHERE workspace_id=NEW.workspace_id AND id=job AND actor_id=current_setting('app.user_id',true) AND lease_token=current_setting('app.billing_job_token',true) AND fence::text=current_setting('app.billing_job_fence',true) AND lease_until>clock_timestamp() AND state IN('running','waiting_provider','cancelling') AND kind='generation';
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_JOB';END IF;
  -- A valid receipt from a job accepted before the metering cutover is not charged retrospectively.
  IF j.created_at<(SELECT cutover_at FROM app.billing_account WHERE workspace_id=NEW.workspace_id) THEN RETURN NEW;END IF;
  unit:=CASE WHEN j.source='APOLLO' THEN 'imports' ELSE 'extractions' END;hold:='job:'||job;
 END IF;
 PERFORM app.billing_consume('lead:'||NEW.id,unit,1,hold);RETURN NEW;
END $$;
CREATE TRIGGER billing_guard_lead AFTER INSERT ON app.lead FOR EACH ROW EXECUTE FUNCTION app.billing_guard_lead();

CREATE FUNCTION app.billing_guard_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text;cap jsonb;used bigint;key text;expanding boolean:=false;
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker','cadence_dispatcher') THEN RETURN NEW;END IF;ws:=NEW.workspace_id;
 IF TG_TABLE_NAME='channel_connection' THEN
  expanding:=NEW.archived_at IS NULL AND NEW.state<>'disconnected' AND(TG_OP='INSERT' OR OLD.archived_at IS NOT NULL OR OLD.state='disconnected' OR OLD.channel<>NEW.channel);
  key:=CASE WHEN NEW.channel='EMAIL' THEN 'mailboxes' ELSE 'whatsapp' END;
 ELSIF TG_TABLE_NAME='cadence' THEN expanding:=NEW.payload->>'status'='active' AND(TG_OP='INSERT' OR OLD.payload->>'status' IS DISTINCT FROM 'active');key:='cadences';
 ELSE expanding:=NEW.status='active' AND(TG_OP='INSERT' OR OLD.status<>'active');key:='automations';END IF;
 IF NOT expanding THEN RETURN NEW;END IF;
 SELECT c.capacity INTO cap FROM app.billing_account a JOIN app.billing_catalog c ON c.sku=COALESCE(a.plan,'essential') WHERE a.workspace_id=ws FOR UPDATE OF a;
 IF TG_TABLE_NAME='channel_connection' THEN SELECT count(*) INTO used FROM app.channel_connection WHERE workspace_id=ws AND channel=NEW.channel AND archived_at IS NULL AND state<>'disconnected' AND id<>NEW.id;
 ELSIF TG_TABLE_NAME='cadence' THEN PERFORM app.billing_require_execution(ws);SELECT count(*) INTO used FROM app.cadence WHERE workspace_id=ws AND payload->>'status'='active' AND id<>NEW.id;
 ELSE PERFORM app.billing_require_execution(ws);SELECT count(*) INTO used FROM app.automation_runtime WHERE workspace_id=ws AND status='active' AND automation_id<>NEW.automation_id;END IF;
 IF cap IS NULL OR used>=(cap->>key)::integer THEN RAISE EXCEPTION 'BILLING_CAPACITY';END IF;RETURN NEW;
END $$;
CREATE TRIGGER billing_guard_capacity BEFORE INSERT OR UPDATE ON app.channel_connection FOR EACH ROW EXECUTE FUNCTION app.billing_guard_capacity();
CREATE TRIGGER billing_guard_capacity BEFORE INSERT OR UPDATE ON app.cadence FOR EACH ROW EXECUTE FUNCTION app.billing_guard_capacity();
CREATE TRIGGER billing_guard_capacity BEFORE INSERT OR UPDATE ON app.automation_runtime FOR EACH ROW EXECUTE FUNCTION app.billing_guard_capacity();

CREATE FUNCTION app.billing_guard_seat() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=NEW."organizationId";cap integer;used integer;target_email text;
BEGIN
 IF session_user<>'cadence_auth' THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='invitation' THEN
  IF NEW.status<>'pending' OR NEW."expiresAt"<=clock_timestamp() THEN RETURN NEW;END IF;target_email:=lower(NEW.email);
 ELSE SELECT lower(u.email) INTO target_email FROM auth."user" u WHERE u.id=NEW."userId";END IF;
 SELECT (c.capacity->>'seats')::integer INTO cap FROM app.billing_account a JOIN app.billing_catalog c ON c.sku=COALESCE(a.plan,'essential') WHERE a.workspace_id=ws FOR UPDATE OF a;
 SELECT count(*) INTO used FROM auth.member m WHERE m."organizationId"=ws AND(TG_TABLE_NAME='invitation' OR m.id<>NEW.id);
 used:=used+(SELECT count(DISTINCT lower(i.email)) FROM auth.invitation i WHERE i."organizationId"=ws AND i.status='pending' AND i."expiresAt">clock_timestamp() AND lower(i.email)<>target_email AND NOT EXISTS(SELECT 1 FROM auth.member m JOIN auth."user" u ON u.id=m."userId" WHERE m."organizationId"=ws AND lower(u.email)=lower(i.email)));
 IF TG_TABLE_NAME='invitation' AND EXISTS(SELECT 1 FROM auth.member m JOIN auth."user" u ON u.id=m."userId" WHERE m."organizationId"=ws AND lower(u.email)=target_email) THEN RETURN NEW;END IF;
 IF cap IS NULL OR used>=cap THEN RAISE EXCEPTION 'BILLING_CAPACITY';END IF;RETURN NEW;
END $$;
CREATE TRIGGER billing_guard_seat BEFORE INSERT ON auth.member FOR EACH ROW EXECUTE FUNCTION app.billing_guard_seat();
CREATE TRIGGER billing_guard_seat BEFORE INSERT OR UPDATE ON auth.invitation FOR EACH ROW EXECUTE FUNCTION app.billing_guard_seat();

ALTER FUNCTION app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) RENAME TO begin_message_dispatch_pre_billing;
CREATE FUNCTION app.begin_message_dispatch(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_guard jsonb,p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.message_outbox;s app.channel_sender;used bigint;used_sender bigint;lim app.messaging_limits;daily integer;period date;
BEGIN
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=p_ws FOR UPDATE;
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=p_ws AND message_id=p_message AND lease_token=p_token AND fence=p_fence AND lease_until>clock_timestamp() AND state='pending' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'code','STALE_LEASE');END IF;
 BEGIN PERFORM app.billing_require_execution(p_ws);EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'BILLING_REQUIRED' THEN RAISE;END IF;
  PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'BILLING_REQUIRED');RETURN jsonb_build_object('allowed',false,'code','BILLING_REQUIRED');
 END;
 IF o.prepared_send->>'channel'='EMAIL' THEN
  SELECT * INTO lim FROM app.messaging_limits WHERE workspace_id=p_ws;SELECT * INTO s FROM app.channel_sender WHERE workspace_id=p_ws AND id=o.sender_id;
  period:=(p_now AT TIME ZONE COALESCE(lim.timezone,'America/Sao_Paulo'))::date;
  SELECT CASE WHEN plan='pro' THEN 500 ELSE 300 END INTO daily FROM app.billing_account WHERE workspace_id=p_ws;
  SELECT COALESCE(sum(l.units*CASE WHEN l.event='release' THEN -1 ELSE 1 END),0),COALESCE(sum(l.units*CASE WHEN l.event='release' THEN -1 ELSE 1 END) FILTER(WHERE l.sender_id=s.id),0) INTO used,used_sender FROM app.message_usage_ledger l JOIN app.channel_sender cs ON cs.workspace_id=l.workspace_id AND cs.id=l.sender_id WHERE l.workspace_id=p_ws AND l.period_date=period AND cs.channel='EMAIL';
  IF used>=daily OR used_sender>=100 THEN UPDATE app.message_outbox SET next_at=((period+1)::timestamp AT TIME ZONE COALESCE(lim.timezone,'America/Sao_Paulo')),lease_until=NULL,blocked_code='BILLING_DAILY_LIMIT' WHERE workspace_id=p_ws AND message_id=p_message;RETURN jsonb_build_object('allowed',false,'code','BILLING_DAILY_LIMIT');END IF;
 END IF;
 RETURN app.begin_message_dispatch_pre_billing(p_ws,p_message,p_attempt,p_token,p_fence,p_guard,p_now);
END $$;
REVOKE ALL ON FUNCTION app.billing_guard_job(),app.billing_guard_outbox(),app.billing_guard_lead(),app.billing_guard_capacity(),app.billing_guard_seat(),app.begin_message_dispatch_pre_billing(text,text,text,text,bigint,jsonb,timestamptz),app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher;
GRANT EXECUTE ON FUNCTION app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) TO cadence_dispatcher;
