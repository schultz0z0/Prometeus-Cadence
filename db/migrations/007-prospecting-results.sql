CREATE TABLE app.lead_identity(
 workspace_id text NOT NULL,list_id text NOT NULL,identity text NOT NULL,lead_id text NOT NULL,
 PRIMARY KEY(workspace_id,list_id,identity),
 FOREIGN KEY(workspace_id,lead_id) REFERENCES app.lead(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,list_id) REFERENCES app.list(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX lead_identity_workspace ON app.lead_identity(workspace_id,identity);
CREATE TABLE app.identity_collision(workspace_id text NOT NULL,lead_id text NOT NULL,identity text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,lead_id,identity));
CREATE TABLE app.lead_evidence(
 workspace_id text NOT NULL,id text NOT NULL,lead_id text NOT NULL,job_id text NOT NULL,
 url text NOT NULL,text text NOT NULL CHECK(length(text)<=12000),hash text NOT NULL,truncated boolean NOT NULL,fetched_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,lead_id) REFERENCES app.lead(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id)
);
CREATE TABLE app.prospecting_receipt(
 workspace_id text NOT NULL,job_id text NOT NULL,id text NOT NULL,body_hash text NOT NULL,counts jsonb NOT NULL,
 PRIMARY KEY(workspace_id,job_id,id),FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['lead_identity','identity_collision','lead_evidence','prospecting_receipt'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY workspace_isolation ON app.%I USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL) WITH CHECK(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
 END LOOP;
END $$;
-- Registry identity is maintained even when a lead is edited/imported manually.
-- Source identities are private provenance and cannot be supplied by public CRUD.
CREATE FUNCTION app.sync_lead_registry_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE registry text; owner_id text;
BEGIN
 DELETE FROM app.lead_identity WHERE workspace_id=NEW.workspace_id AND lead_id=NEW.id AND (identity LIKE 'cnpj:%' OR list_id<>NEW.list_id);
 registry:=upper(regexp_replace(COALESCE(NEW.payload->>'cnpj',''),'[./[:space:]-]','','g'));
 IF registry ~ '^[A-Z0-9]{12}[0-9]{2}$' THEN
  INSERT INTO app.lead_identity VALUES(NEW.workspace_id,NEW.list_id,'cnpj:'||registry,NEW.id) ON CONFLICT DO NOTHING;
  SELECT lead_id INTO owner_id FROM app.lead_identity WHERE workspace_id=NEW.workspace_id AND list_id=NEW.list_id AND identity='cnpj:'||registry;
  IF owner_id IS DISTINCT FROM NEW.id THEN INSERT INTO app.identity_collision VALUES(NEW.workspace_id,NEW.id,'cnpj:'||registry,now()) ON CONFLICT DO NOTHING; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lead_registry_identity AFTER INSERT OR UPDATE ON app.lead FOR EACH ROW EXECUTE FUNCTION app.sync_lead_registry_identity();
-- Backfill without deleting or merging legacy collisions.
INSERT INTO app.lead_identity(workspace_id,list_id,identity,lead_id)
 SELECT DISTINCT ON(workspace_id,list_id,registry) workspace_id,list_id,'cnpj:'||registry,id
 FROM (SELECT workspace_id,list_id,id,upper(regexp_replace(COALESCE(payload->>'cnpj',''),'[./[:space:]-]','','g')) registry FROM app.lead) x
 WHERE registry ~ '^[A-Z0-9]{12}[0-9]{2}$' ORDER BY workspace_id,list_id,registry,id;
INSERT INTO app.identity_collision(workspace_id,lead_id,identity)
 SELECT l.workspace_id,l.id,i.identity FROM app.lead l JOIN app.lead_identity i ON i.workspace_id=l.workspace_id AND i.list_id=l.list_id AND i.identity='cnpj:'||upper(regexp_replace(COALESCE(l.payload->>'cnpj',''),'[./[:space:]-]','','g')) WHERE i.lead_id<>l.id;
