-- A last accepted message is not a completion timestamp. Historical completions
-- without a recorded transition remain ineligible rather than inventing an age.
ALTER TABLE app.cadence_enrollment ADD COLUMN completed_at timestamptz;
CREATE FUNCTION app.stamp_enrollment_completion() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.state='completed' AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM 'completed') THEN
  NEW.completed_at:=CASE WHEN session_user IN('cadence_app','cadence_worker','cadence_dispatcher') THEN clock_timestamp() ELSE COALESCE(NEW.completed_at,clock_timestamp()) END;
 ELSIF NEW.state<>'completed' THEN NEW.completed_at:=NULL;END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.stamp_enrollment_completion() FROM PUBLIC;
CREATE TRIGGER stamp_enrollment_completion BEFORE INSERT OR UPDATE OF state ON app.cadence_enrollment FOR EACH ROW EXECUTE FUNCTION app.stamp_enrollment_completion();
CREATE INDEX cadence_completed_reengage ON app.cadence_enrollment(workspace_id,lead_id,completed_at) WHERE state='completed';
ALTER TABLE app.automation_lead_assignment DROP CONSTRAINT automation_lead_assignment_state_check;
ALTER TABLE app.automation_lead_assignment ADD CHECK(state IN('assigned','attempted','pending_review','uncertain','failed','skipped','released','transferred'));
GRANT SELECT ON app.cadence,app.cadence_publication,app.cadence_enrollment,app.cadence_enrollment_channel,app.channel_identity,app.contact_suppression,app.message_outbox TO cadence_worker;
