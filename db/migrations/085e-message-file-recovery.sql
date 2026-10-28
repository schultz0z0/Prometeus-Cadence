ALTER TABLE app.message_attachment DROP CONSTRAINT message_attachment_state_check;
ALTER TABLE app.message_attachment ADD CONSTRAINT message_attachment_state_check CHECK(state IN('pending','ready','rejected','deleted'));
ALTER TABLE app.message_attachment ADD COLUMN purged_at timestamptz;
CREATE OR REPLACE FUNCTION app.limit_message_files() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('message-files:'||NEW.workspace_id));
 IF (SELECT COALESCE(sum(size),0) FROM app.message_attachment WHERE workspace_id=NEW.workspace_id AND (state IN('pending','ready') OR(state='deleted' AND purged_at IS NULL)))+NEW.size>209715200 THEN RAISE EXCEPTION 'AUTHORING_FILE_QUOTA';END IF;RETURN NEW;
END $$;
CREATE FUNCTION app.message_file_referenced(p_ws text,p_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.cadence c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.payload->'steps','[]')) s WHERE c.workspace_id=p_ws AND(COALESCE(s->'attachmentIds','[]') ? p_id OR COALESCE(s->'variantB'->'attachmentIds','[]') ? p_id))
 OR EXISTS(SELECT 1 FROM app.cadence_publication p CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.snapshot->'recipients','[]')) r CROSS JOIN LATERAL jsonb_each(COALESCE(r->'steps','{}')) s CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.value->'attachments','[]')) f WHERE p.workspace_id=p_ws AND f->>'id'=p_id)
$$;
REVOKE ALL ON FUNCTION app.message_file_referenced(text,text) FROM PUBLIC,cadence_worker,cadence_dispatcher;
-- Bound to the current workspace; the app cannot probe another namespace.
CREATE FUNCTION app.message_file_is_unused(p_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.current_role() IN('owner','admin','operator') AND NOT app.message_file_referenced(current_setting('app.workspace_id',true),p_id)
$$;
REVOKE ALL ON FUNCTION app.message_file_is_unused(text) FROM PUBLIC,cadence_worker,cadence_dispatcher;GRANT EXECUTE ON FUNCTION app.message_file_is_unused(text) TO cadence_app;
CREATE FUNCTION app.retire_unused_message_file(p_id text,p_purged boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.message_attachment;
BEGIN
 IF app.current_role() NOT IN('owner','admin','operator') OR app.current_role() IS NULL THEN RAISE EXCEPTION 'AUTHORING_WRITER_REQUIRED';END IF;
 PERFORM 1 FROM app.workspace_meta WHERE workspace_id=ws FOR UPDATE;
 SELECT * INTO a FROM app.message_attachment WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF app.message_file_referenced(ws,p_id) THEN RAISE EXCEPTION 'AUTHORING_FILE_REFERENCED';END IF;
 IF p_purged AND a.state<>'deleted' THEN RAISE EXCEPTION 'AUTHORING_FILE_NOT_RETIRED';END IF;
 UPDATE app.message_attachment SET state='deleted',purged_at=CASE WHEN p_purged THEN clock_timestamp() ELSE purged_at END WHERE workspace_id=ws AND id=p_id;
 RETURN jsonb_build_object('key',a.storage_key);
END $$;
REVOKE ALL ON FUNCTION app.retire_unused_message_file(text,boolean) FROM PUBLIC,cadence_worker,cadence_dispatcher;GRANT EXECUTE ON FUNCTION app.retire_unused_message_file(text,boolean) TO cadence_app;
-- A retired request ID can never revive bytes or a historical reference.
CREATE FUNCTION app.guard_retired_message_file() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN IF OLD.state='deleted' AND NEW.state<>'deleted' THEN RAISE EXCEPTION 'AUTHORING_FILE_RETIRED';END IF;RETURN NEW;END $$;
CREATE TRIGGER retired_message_file BEFORE UPDATE ON app.message_attachment FOR EACH ROW EXECUTE FUNCTION app.guard_retired_message_file();
-- Serialize new draft/publication references with explicit retirement.
CREATE FUNCTION app.lock_authoring_workspace() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM 1 FROM app.workspace_meta WHERE workspace_id=NEW.workspace_id FOR UPDATE;RETURN NEW;END $$;
CREATE TRIGGER aaa_authoring_workspace BEFORE INSERT OR UPDATE ON app.cadence FOR EACH ROW EXECUTE FUNCTION app.lock_authoring_workspace();
CREATE TRIGGER aaa_authoring_workspace BEFORE INSERT ON app.cadence_publication FOR EACH ROW EXECUTE FUNCTION app.lock_authoring_workspace();
CREATE FUNCTION app.guard_draft_retired_file() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.payload->'steps','[]')) s CROSS JOIN LATERAL(SELECT COALESCE(s->'attachmentIds','[]') ids UNION ALL SELECT COALESCE(s->'variantB'->'attachmentIds','[]')) v CROSS JOIN LATERAL jsonb_array_elements_text(v.ids) f JOIN app.message_attachment a ON a.workspace_id=NEW.workspace_id AND a.id=f WHERE a.state='deleted') THEN RAISE EXCEPTION 'AUTHORING_FILE_RETIRED';END IF;RETURN NEW;
END $$;
CREATE TRIGGER draft_retired_file BEFORE INSERT OR UPDATE ON app.cadence FOR EACH ROW EXECUTE FUNCTION app.guard_draft_retired_file();
