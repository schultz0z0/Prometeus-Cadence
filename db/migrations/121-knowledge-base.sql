-- Company knowledge base (15/11/2026): documents belong to the workspace; agents choose which ones they read. SDR first.
CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;

CREATE TABLE app.knowledge_document(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL DEFAULT gen_random_uuid()::text,revision bigint NOT NULL DEFAULT 1,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),mime text NOT NULL,bytes bigint NOT NULL CHECK(bytes BETWEEN 1 AND 10485760),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),blob_key text NOT NULL,
 state text NOT NULL DEFAULT 'uploaded' CHECK(state IN('uploaded','processing','ready','approved','failed','archived')),
 error text,pages integer,chunks integer,usage jsonb NOT NULL DEFAULT '{}',
 uploaded_by text NOT NULL,approved_by text,approved_at timestamptz,
 lease_token text,lease_until timestamptz,attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id)
);
CREATE INDEX knowledge_document_queue ON app.knowledge_document(created_at) WHERE state IN('uploaded','processing');
CREATE UNIQUE INDEX knowledge_document_hash ON app.knowledge_document(workspace_id,sha256) WHERE state<>'archived';

CREATE TABLE app.knowledge_chunk(
 workspace_id text NOT NULL,document_id text NOT NULL,ordinal integer NOT NULL,label text NOT NULL,text text NOT NULL CHECK(length(text) BETWEEN 1 AND 6000),
 embedding public.vector(1536) NOT NULL,tsv tsvector NOT NULL,
 PRIMARY KEY(workspace_id,document_id,ordinal),
 FOREIGN KEY(workspace_id,document_id) REFERENCES app.knowledge_document(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX knowledge_chunk_embedding ON app.knowledge_chunk USING hnsw(embedding public.vector_cosine_ops);
CREATE INDEX knowledge_chunk_tsv ON app.knowledge_chunk USING gin(tsv);
CREATE INDEX knowledge_chunk_scope ON app.knowledge_chunk(workspace_id,document_id);

DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['knowledge_document','knowledge_chunk'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY ws_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
END LOOP;END $$;
GRANT SELECT ON app.knowledge_document,app.knowledge_chunk TO cadence_app;

-- App (owner/admin, Pro): register an uploaded file; the blob is already stored under blob_key.
CREATE FUNCTION app.knowledge_register(p_title text,p_mime text,p_bytes bigint,p_sha256 text,p_blob_key text) RETURNS app.knowledge_document
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);d app.knowledge_document;r text:=app.sdr_guard(true);
BEGIN
 IF (SELECT count(*) FROM app.knowledge_document WHERE workspace_id=ws AND state<>'archived')>=50 THEN RAISE EXCEPTION 'KNOWLEDGE_LIMIT';END IF;
 IF EXISTS(SELECT 1 FROM app.knowledge_document WHERE workspace_id=ws AND sha256=p_sha256 AND state<>'archived') THEN RAISE EXCEPTION 'KNOWLEDGE_DUPLICATE';END IF;
 INSERT INTO app.knowledge_document(workspace_id,title,mime,bytes,sha256,blob_key,uploaded_by) VALUES(ws,p_title,p_mime,p_bytes,p_sha256,p_blob_key,uid) RETURNING * INTO d;
 RETURN d;
END $$;

CREATE FUNCTION app.knowledge_set_state(p_id text,p_expected bigint,p_state text) RETURNS app.knowledge_document
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);d app.knowledge_document;r text:=app.sdr_role(true);
BEGIN
 SELECT * INTO d FROM app.knowledge_document WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND';END IF;
 IF d.revision<>p_expected THEN RAISE EXCEPTION 'KNOWLEDGE_CHANGED';END IF;
 IF p_state='approved' AND d.state<>'ready' THEN RAISE EXCEPTION 'KNOWLEDGE_STATE';END IF;
 IF p_state='archived' AND d.state='archived' THEN RAISE EXCEPTION 'KNOWLEDGE_STATE';END IF;
 IF p_state NOT IN('approved','archived') THEN RAISE EXCEPTION 'KNOWLEDGE_STATE';END IF;
 UPDATE app.knowledge_document SET state=p_state,revision=revision+1,updated_at=clock_timestamp(),
  approved_at=CASE WHEN p_state='approved' THEN clock_timestamp() ELSE approved_at END,approved_by=CASE WHEN p_state='approved' THEN uid ELSE approved_by END
  WHERE workspace_id=ws AND id=p_id RETURNING * INTO d;
 RETURN d;
END $$;

-- Returns the blob key so the service can remove the stored file; chunks go with the row.
CREATE FUNCTION app.knowledge_delete(p_id text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);k text;r text:=app.sdr_role(true);
BEGIN
 DELETE FROM app.knowledge_document WHERE workspace_id=ws AND id=p_id RETURNING blob_key INTO k;
 IF k IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND';END IF;
 RETURN k;
END $$;

-- Worker: one document at a time, with a lease; an expired lease is taken again (up to 3 attempts).
CREATE FUNCTION app.knowledge_claim_ingest(p_token text,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d app.knowledge_document;
BEGIN
 UPDATE app.knowledge_document SET state='failed',error='KNOWLEDGE_ATTEMPTS',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
  WHERE state='processing' AND lease_until<=p_now AND attempts>=3;
 SELECT * INTO d FROM app.knowledge_document WHERE (state='uploaded' OR (state='processing' AND lease_until<=p_now))
  ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE app.knowledge_document SET state='processing',lease_token=p_token,lease_until=p_now+interval '10 minutes',attempts=attempts+1,updated_at=clock_timestamp()
  WHERE workspace_id=d.workspace_id AND id=d.id;
 RETURN jsonb_build_object('workspaceId',d.workspace_id,'id',d.id,'mime',d.mime,'blobKey',d.blob_key,'title',d.title);
END $$;

-- p_result: {kind:'ready',pages,usage,chunks:[{ordinal,label,text,embedding:[...1536]}]} | {kind:'failed',code}. All or nothing.
CREATE FUNCTION app.knowledge_finish_ingest(p_ws text,p_id text,p_token text,p_result jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d app.knowledge_document;n integer:=jsonb_array_length(coalesce(p_result->'chunks','[]'));
BEGIN
 SELECT * INTO d FROM app.knowledge_document WHERE workspace_id=p_ws AND id=p_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'processing' OR d.lease_token IS DISTINCT FROM p_token THEN RETURN 'STALE';END IF;
 IF p_result->>'kind'='ready' AND n>0 AND (SELECT count(*) FROM app.knowledge_chunk WHERE workspace_id=p_ws)+n>20000 THEN
  p_result:=jsonb_build_object('kind','failed','code','KNOWLEDGE_CHUNK_LIMIT');
 END IF;
 IF p_result->>'kind'='ready' AND n>0 THEN
  DELETE FROM app.knowledge_chunk WHERE workspace_id=p_ws AND document_id=p_id;
  INSERT INTO app.knowledge_chunk(workspace_id,document_id,ordinal,label,text,embedding,tsv)
   SELECT p_ws,p_id,(c->>'ordinal')::integer,left(c->>'label',200),c->>'text',(c->>'embedding')::public.vector,
    to_tsvector('portuguese'::regconfig,public.unaccent(coalesce(c->>'label','')||' '||(c->>'text')))
   FROM jsonb_array_elements(p_result->'chunks') c;
  UPDATE app.knowledge_document SET state='ready',error=NULL,pages=(p_result->>'pages')::integer,chunks=n,usage=coalesce(p_result->'usage','{}'),
   lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_id;
  RETURN 'READY';
 END IF;
 UPDATE app.knowledge_document SET state='failed',error=left(coalesce(p_result->>'code','KNOWLEDGE_EMPTY'),100),lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=clock_timestamp()
  WHERE workspace_id=p_ws AND id=p_id;
 RETURN 'FAILED';
END $$;

-- Worker: search only the given workspace's approved documents. Called twice per query (vector, text) and fused in the app.
CREATE FUNCTION app.knowledge_search(p_ws text,p_documents text[],p_embedding public.vector,p_query text,p_k integer)
RETURNS TABLE(id text,document_id text,title text,label text,text text,vector_rank integer,text_rank integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 SET LOCAL hnsw.iterative_scan=relaxed_order;
 RETURN QUERY
 WITH docs AS (SELECT d.id,d.title FROM app.knowledge_document d WHERE d.workspace_id=p_ws AND d.state='approved' AND d.id=ANY(p_documents)),
 v AS (SELECT c.document_id,c.ordinal,row_number() OVER (ORDER BY c.embedding<=>p_embedding)::integer r FROM app.knowledge_chunk c
   WHERE p_embedding IS NOT NULL AND c.workspace_id=p_ws AND c.document_id IN(SELECT docs.id FROM docs) ORDER BY c.embedding<=>p_embedding LIMIT least(p_k,50)),
 t AS (SELECT c.document_id,c.ordinal,row_number() OVER (ORDER BY ts_rank(c.tsv,q) DESC)::integer r FROM app.knowledge_chunk c,websearch_to_tsquery('portuguese'::regconfig,public.unaccent(coalesce(p_query,''))) q
   WHERE coalesce(p_query,'')<>'' AND c.workspace_id=p_ws AND c.document_id IN(SELECT docs.id FROM docs) AND c.tsv@@q ORDER BY ts_rank(c.tsv,q) DESC LIMIT least(p_k,50))
 SELECT c.document_id||':'||c.ordinal,c.document_id,docs.title,c.label,c.text,v.r,t.r
 FROM app.knowledge_chunk c JOIN docs ON docs.id=c.document_id
 LEFT JOIN v ON v.document_id=c.document_id AND v.ordinal=c.ordinal LEFT JOIN t ON t.document_id=c.document_id AND t.ordinal=c.ordinal
 WHERE c.workspace_id=p_ws AND (v.r IS NOT NULL OR t.r IS NOT NULL);
END $$;

REVOKE ALL ON FUNCTION app.knowledge_register(text,text,bigint,text,text),app.knowledge_set_state(text,bigint,text),app.knowledge_delete(text),
 app.knowledge_claim_ingest(text,timestamptz),app.knowledge_finish_ingest(text,text,text,jsonb),app.knowledge_search(text,text[],public.vector,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.knowledge_register(text,text,bigint,text,text),app.knowledge_set_state(text,bigint,text),app.knowledge_delete(text) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.knowledge_claim_ingest(text,timestamptz),app.knowledge_finish_ingest(text,text,text,jsonb),app.knowledge_search(text,text[],public.vector,text,integer) TO cadence_worker;
GRANT USAGE ON SCHEMA public TO cadence_worker;
