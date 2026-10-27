CREATE TABLE app.message_attachment(
 workspace_id text NOT NULL REFERENCES app.workspace_meta(workspace_id),id text NOT NULL,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),mime text NOT NULL,
 size integer NOT NULL CHECK(size BETWEEN 1 AND 10485760),hash text NOT NULL CHECK(hash~'^[a-f0-9]{64}$'),storage_key text NOT NULL CHECK(storage_key~'^[a-f0-9-]{36}$'),
 state text NOT NULL CHECK(state IN('pending','ready','rejected')),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,storage_key)
);
CREATE TABLE app.cadence_content_revision(
 workspace_id text NOT NULL,cadence_id text NOT NULL,revision bigint NOT NULL CHECK(revision>0),hash text NOT NULL,steps jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,cadence_id,revision),
 FOREIGN KEY(workspace_id,cadence_id) REFERENCES app.cadence(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE app.cadence_variant(
 workspace_id text NOT NULL,cadence_id text NOT NULL,revision bigint NOT NULL,step_id text NOT NULL,variant text NOT NULL CHECK(variant IN('A','B')),content jsonb NOT NULL,
 PRIMARY KEY(workspace_id,cadence_id,revision,step_id,variant),FOREIGN KEY(workspace_id,cadence_id,revision) REFERENCES app.cadence_content_revision(workspace_id,cadence_id,revision) ON DELETE CASCADE
);
ALTER TABLE app.message_attachment ENABLE ROW LEVEL SECURITY;ALTER TABLE app.message_attachment FORCE ROW LEVEL SECURITY;
ALTER TABLE app.cadence_content_revision ENABLE ROW LEVEL SECURITY;ALTER TABLE app.cadence_content_revision FORCE ROW LEVEL SECURITY;
ALTER TABLE app.cadence_variant ENABLE ROW LEVEL SECURITY;ALTER TABLE app.cadence_variant FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.message_attachment,app.cadence_content_revision,app.cadence_variant FROM cadence_app,cadence_worker,cadence_dispatcher;
CREATE POLICY tenant_read ON app.message_attachment FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
CREATE POLICY tenant_read ON app.cadence_content_revision FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
CREATE POLICY tenant_read ON app.cadence_variant FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
CREATE POLICY writer_insert ON app.message_attachment FOR INSERT WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND created_by=current_setting('app.user_id',true) AND app.current_role() IN('owner','admin','operator') AND state='pending');
CREATE POLICY writer_update ON app.message_attachment FOR UPDATE USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin','operator')) WITH CHECK(state IN('ready','rejected'));
GRANT SELECT,INSERT ON app.message_attachment TO cadence_app;
GRANT UPDATE(state) ON app.message_attachment TO cadence_app;
GRANT SELECT ON app.cadence_content_revision,app.cadence_variant TO cadence_app;
CREATE FUNCTION app.limit_message_files() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('message-files:'||NEW.workspace_id));
 IF (SELECT COALESCE(sum(size),0) FROM app.message_attachment WHERE workspace_id=NEW.workspace_id)+NEW.size>209715200 THEN RAISE EXCEPTION 'AUTHORING_FILE_QUOTA';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER message_file_quota BEFORE INSERT ON app.message_attachment FOR EACH ROW EXECUTE FUNCTION app.limit_message_files();

CREATE FUNCTION app.snapshot_cadence_content() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE next_revision bigint;step jsonb;variant jsonb;file text;files jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.payload->'steps'=NEW.payload->'steps' THEN RETURN NEW;END IF;
 FOR step IN SELECT value FROM jsonb_array_elements(NEW.payload->'steps') LOOP
  FOR variant IN SELECT step UNION ALL SELECT step->'variantB' WHERE step ? 'variantB' LOOP
   files:=COALESCE(variant->'attachmentIds','[]');
   IF jsonb_typeof(files)<>'array' OR jsonb_array_length(files)>5 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(files))<>jsonb_array_length(files) THEN RAISE EXCEPTION 'AUTHORING_ATTACHMENT_LIMIT';END IF;
   FOR file IN SELECT value FROM jsonb_array_elements_text(files) LOOP
    IF NOT EXISTS(SELECT 1 FROM app.message_attachment WHERE workspace_id=NEW.workspace_id AND id=file) THEN RAISE EXCEPTION 'AUTHORING_ATTACHMENT_UNAVAILABLE';END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 SELECT COALESCE(max(revision),0)+1 INTO next_revision FROM app.cadence_content_revision WHERE workspace_id=NEW.workspace_id AND cadence_id=NEW.id;
 INSERT INTO app.cadence_content_revision(workspace_id,cadence_id,revision,hash,steps) VALUES(NEW.workspace_id,NEW.id,next_revision,encode(sha256(convert_to((NEW.payload->'steps')::text,'UTF8')),'hex'),NEW.payload->'steps');
 FOR step IN SELECT value FROM jsonb_array_elements(NEW.payload->'steps') LOOP
  INSERT INTO app.cadence_variant VALUES(NEW.workspace_id,NEW.id,next_revision,step->>'id','A',jsonb_build_object('body',step->'body','subject',step->'subject','attachmentIds',COALESCE(step->'attachmentIds','[]')));
  IF step ? 'variantB' THEN INSERT INTO app.cadence_variant VALUES(NEW.workspace_id,NEW.id,next_revision,step->>'id','B',step->'variantB');END IF;
 END LOOP;RETURN NEW;
END $$;
CREATE TRIGGER snapshot_content AFTER INSERT OR UPDATE ON app.cadence FOR EACH ROW EXECUTE FUNCTION app.snapshot_cadence_content();
-- Capture existing editable content without changing its payload or schedule.
INSERT INTO app.cadence_content_revision(workspace_id,cadence_id,revision,hash,steps) SELECT workspace_id,id,1,encode(sha256(convert_to((payload->'steps')::text,'UTF8')),'hex'),payload->'steps' FROM app.cadence;
INSERT INTO app.cadence_variant SELECT r.workspace_id,r.cadence_id,1,s->>'id','A',jsonb_build_object('body',s->'body','subject',s->'subject','attachmentIds','[]'::jsonb) FROM app.cadence_content_revision r CROSS JOIN LATERAL jsonb_array_elements(r.steps) s;

-- New attachment references must match ready private metadata, including under direct SQL.
CREATE FUNCTION app.guard_authoring_publication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.cadence_content_revision;recipient jsonb;step jsonb;file jsonb;a app.message_attachment;
BEGIN
 IF NEW.snapshot ? 'contentRevision' THEN
  SELECT * INTO r FROM app.cadence_content_revision WHERE workspace_id=NEW.workspace_id AND cadence_id=NEW.cadence_id ORDER BY revision DESC LIMIT 1;
  IF r.revision IS DISTINCT FROM (NEW.snapshot->>'contentRevision')::bigint OR r.hash IS DISTINCT FROM NEW.snapshot->>'contentHash' THEN RAISE EXCEPTION 'AUTHORING_CONTENT_CHANGED';END IF;
 END IF;
 FOR recipient IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.snapshot->'recipients','[]')) LOOP
  FOR step IN SELECT value FROM jsonb_each(COALESCE(recipient->'steps','{}')) LOOP
   IF jsonb_array_length(COALESCE(step->'attachments','[]'))>5 THEN RAISE EXCEPTION 'AUTHORING_ATTACHMENT_LIMIT';END IF;
   FOR file IN SELECT value FROM jsonb_array_elements(COALESCE(step->'attachments','[]')) LOOP
    SELECT * INTO a FROM app.message_attachment WHERE workspace_id=NEW.workspace_id AND id=file->>'id';
    IF NOT FOUND OR a.state<>'ready' OR a.hash<>file->>'hash' OR a.mime<>file->>'mime' OR a.name<>file->>'name' OR a.size<>(file->>'size')::integer OR step->'sender'->>'channel'<>'EMAIL' THEN RAISE EXCEPTION 'AUTHORING_ATTACHMENT_UNAVAILABLE';END IF;
   END LOOP;
  END LOOP;
 END LOOP;RETURN NEW;
END $$;
CREATE TRIGGER authoring_publication BEFORE INSERT ON app.cadence_publication FOR EACH ROW EXECUTE FUNCTION app.guard_authoring_publication();
