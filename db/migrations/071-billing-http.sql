CREATE TABLE app.billing_request_rate(workspace_id text NOT NULL,user_id text NOT NULL,kind text NOT NULL,window_at timestamptz NOT NULL,count integer NOT NULL,PRIMARY KEY(workspace_id,user_id,kind));
REVOKE ALL ON app.billing_request_rate FROM PUBLIC,cadence_app,cadence_worker,cadence_billing;
CREATE FUNCTION app.billing_request_limit(p_kind text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);n integer;maximum integer;
BEGIN
 IF app.current_role() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 maximum:=CASE p_kind WHEN 'read' THEN 120 WHEN 'mutate' THEN 20 WHEN 'reconcile' THEN 2 ELSE 0 END;IF maximum=0 THEN RAISE EXCEPTION 'BILLING_INVALID';END IF;
 INSERT INTO app.billing_request_rate VALUES(ws,uid,p_kind,clock_timestamp(),1) ON CONFLICT(workspace_id,user_id,kind) DO UPDATE SET count=CASE WHEN app.billing_request_rate.window_at<clock_timestamp()-interval '1 minute' THEN 1 ELSE app.billing_request_rate.count+1 END,window_at=CASE WHEN app.billing_request_rate.window_at<clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE app.billing_request_rate.window_at END RETURNING count INTO n;
 IF n>maximum THEN RAISE EXCEPTION 'BILLING_RATE_LIMIT';END IF;
END $$;
CREATE FUNCTION app.billing_save_contact(p_request text,p_revision bigint,p_hash text,p_contact jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.billing_account;o app.billing_operation;newid text:=gen_random_uuid()::text;
BEGIN
 IF app.current_role() NOT IN('owner','admin') OR app.current_role() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO a FROM app.billing_account WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO o FROM app.billing_operation WHERE workspace_id=ws AND request_id=p_request;
 IF FOUND THEN IF o.body_hash<>p_hash OR o.actor_id<>current_setting('app.user_id') THEN RAISE EXCEPTION 'BILLING_REPLAY_CHANGED';END IF;RETURN o.id;END IF;
 IF a.revision<>p_revision THEN RAISE EXCEPTION 'BILLING_CHANGED';END IF;
 IF EXISTS(SELECT 1 FROM app.billing_operation WHERE workspace_id=ws AND kind='contact' AND state IN('prepared','processing','uncertain')) THEN RAISE EXCEPTION 'BILLING_CONTACT_PENDING';END IF;
 UPDATE app.billing_account SET contact=p_contact,revision=revision+1 WHERE workspace_id=ws;
 INSERT INTO app.billing_operation(workspace_id,id,request_id,actor_id,body_hash,kind,expected_revision,state,proof,customer_id) VALUES(ws,newid,p_request,current_setting('app.user_id'),p_hash,'contact',p_revision,CASE WHEN a.customer_id IS NULL THEN 'completed' ELSE 'prepared' END,jsonb_build_object('contact',p_contact),a.customer_id);
 INSERT INTO app.audit(workspace_id,user_id,action) VALUES(ws,current_setting('app.user_id'),'billing.contact');RETURN newid;
END $$;
CREATE FUNCTION app.billing_request_reconcile() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.billing_account;x record;k text;n integer:=0;
BEGIN
 IF app.current_role() IS NULL OR app.current_role() NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO a FROM app.billing_account WHERE workspace_id=current_setting('app.workspace_id');IF a.customer_id IS NULL THEN RETURN 0;END IF;
 FOR x IN SELECT remote_id AS object_id,CASE WHEN kind='checkout' THEN 'billing.checkout' ELSE 'billing.reconcile' END AS type FROM app.billing_operation WHERE workspace_id=a.workspace_id AND state='awaiting_payment' AND remote_id IS NOT NULL UNION SELECT a.subscription_id,'billing.reconcile' WHERE a.subscription_id IS NOT NULL LOOP
  k:='manual:'||gen_random_uuid()::text;
  INSERT INTO app.billing_event_inbox(id,type,object_id,customer_id,created,body_hash) VALUES(k,x.type,x.object_id,a.customer_id,extract(epoch FROM clock_timestamp())::bigint,k);n:=n+1;
 END LOOP;RETURN n;
END $$;
REVOKE ALL ON FUNCTION app.billing_request_limit(text),app.billing_save_contact(text,bigint,text,jsonb),app.billing_request_reconcile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.billing_request_limit(text),app.billing_save_contact(text,bigint,text,jsonb),app.billing_request_reconcile() TO cadence_app;
