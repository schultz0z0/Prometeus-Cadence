CREATE OR REPLACE FUNCTION app.guard_authoring_publication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.cadence_content_revision;recipient jsonb;entry record;step jsonb;selected jsonb;ids jsonb;requires_content boolean;
BEGIN
 PERFORM 1 FROM app.cadence WHERE workspace_id=NEW.workspace_id AND id=NEW.cadence_id FOR SHARE;
 SELECT * INTO r FROM app.cadence_content_revision WHERE workspace_id=NEW.workspace_id AND cadence_id=NEW.cadence_id ORDER BY revision DESC LIMIT 1;
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(r.steps,'[]')) s WHERE s ? 'variantB' OR jsonb_array_length(COALESCE(s->'attachmentIds','[]'))>0) INTO requires_content;
 IF NEW.snapshot ? 'contentRevision' OR requires_content THEN
  IF r.revision IS DISTINCT FROM (NEW.snapshot->>'contentRevision')::bigint OR r.hash IS DISTINCT FROM NEW.snapshot->>'contentHash' OR r.steps IS DISTINCT FROM NEW.snapshot->'cadence'->'steps' THEN RAISE EXCEPTION 'AUTHORING_CONTENT_CHANGED';END IF;
 END IF;
 FOR recipient IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.snapshot->'recipients','[]')) LOOP
  FOR entry IN SELECT * FROM jsonb_each(COALESCE(recipient->'steps','{}')) LOOP
   step:=entry.value;
   IF NOT app.authoring_files_valid(NEW.workspace_id,COALESCE(step->'attachments','[]'),step->'sender'->>'channel') THEN RAISE EXCEPTION 'AUTHORING_ATTACHMENT_UNAVAILABLE';END IF;
   IF NEW.snapshot ? 'contentRevision' THEN
    SELECT CASE WHEN step->>'variant'='B' THEN s->'variantB' ELSE s END INTO selected FROM jsonb_array_elements(r.steps) s WHERE s->>'id'=entry.key;
    IF selected IS NULL OR step->>'variant' IS NULL OR step->>'variant' NOT IN('A','B') THEN RAISE EXCEPTION 'AUTHORING_VARIANT_REQUIRED';END IF;
    SELECT COALESCE(jsonb_agg(f->'id'),'[]') INTO ids FROM jsonb_array_elements(COALESCE(step->'attachments','[]')) f;
    IF ids IS DISTINCT FROM COALESCE(selected->'attachmentIds','[]') THEN RAISE EXCEPTION 'AUTHORING_ATTACHMENT_CHANGED';END IF;
   END IF;
  END LOOP;
 END LOOP;RETURN NEW;
END $$;
