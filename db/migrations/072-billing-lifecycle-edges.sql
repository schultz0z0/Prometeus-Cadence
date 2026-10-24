CREATE FUNCTION app.billing_bind_event_customer(p_id text,p_token text,p_customer text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_customer !~ '^cus_[A-Za-z0-9_]+$' OR NOT EXISTS(SELECT 1 FROM app.billing_account WHERE customer_id=p_customer) THEN RETURN false;END IF;
 UPDATE app.billing_event_inbox SET customer_id=p_customer,state='pending',lease_token=NULL,lease_until=NULL,next_at=clock_timestamp() WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() AND customer_id IS NULL;RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION app.billing_bind_event_customer(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.billing_bind_event_customer(text,text,text) TO cadence_billing;
ALTER FUNCTION app.billing_start_trial(text) RENAME TO billing_start_trial_pre_subscription_guard;
CREATE FUNCTION app.billing_start_trial(p_request text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.billing_account;
BEGIN
 IF app.current_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO a FROM app.billing_account WHERE workspace_id=current_setting('app.workspace_id') FOR UPDATE;
 IF a.subscription_id IS NOT NULL THEN RAISE EXCEPTION 'SUBSCRIPTION_ACTIVE';END IF;RETURN app.billing_start_trial_pre_subscription_guard(p_request);
END $$;
REVOKE ALL ON FUNCTION app.billing_start_trial_pre_subscription_guard(text),app.billing_start_trial(text) FROM PUBLIC,cadence_app;
GRANT EXECUTE ON FUNCTION app.billing_start_trial(text) TO cadence_app;
CREATE FUNCTION app.billing_clear_applied_schedule() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN IF OLD.next_plan IS NOT NULL AND NEW.plan=OLD.next_plan AND NEW.state='active' THEN NEW.next_plan:=NULL;NEW.change_schedule_id:=NULL;END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION app.billing_clear_applied_schedule() FROM PUBLIC;
CREATE TRIGGER billing_clear_applied_schedule BEFORE UPDATE ON app.billing_account FOR EACH ROW EXECUTE FUNCTION app.billing_clear_applied_schedule();
