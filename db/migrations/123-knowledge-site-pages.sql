-- Site pages in the company knowledge base (15/11/2026): each reread of the company site in Contexto de IA keeps one approved
-- document per page (source_url), replaced in place on the next reread; pages gone from the site leave the base.
ALTER TABLE app.knowledge_document ADD COLUMN source_url text CHECK(length(source_url) BETWEEN 1 AND 2048);
CREATE UNIQUE INDEX knowledge_document_site ON app.knowledge_document(workspace_id,source_url) WHERE source_url IS NOT NULL;

-- Worker: what the base already holds for the site, so unchanged pages are not embedded again.
CREATE FUNCTION app.knowledge_site_pages(p_ws text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('entitled',app.sdr_pro(p_ws),'pages',coalesce((SELECT jsonb_object_agg(source_url,sha256) FROM app.knowledge_document WHERE workspace_id=p_ws AND source_url IS NOT NULL),'{}'))
$$;

-- p_pages: [{url,title,sha256,bytes,chunks:[{ordinal,label,text,embedding}]|null}]; null chunks = text unchanged since the last read.
-- One transaction: the base never shows half a reread. Limits of uploads hold (50 documents, 20.000 chunks, unique text).
CREATE FUNCTION app.knowledge_sync_site(p_ws text,p_user text,p_pages jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p jsonb;d app.knowledge_document;n integer;added integer:=0;updated integer:=0;skipped integer:=0;removed integer:=0;
BEGIN
 IF NOT app.sdr_pro(p_ws) THEN RETURN jsonb_build_object('skipped','SDR_PLAN');END IF;
 PERFORM pg_advisory_xact_lock(hashtext('knowledge-site:'||p_ws));
 FOR p IN SELECT * FROM jsonb_array_elements(p_pages) LOOP
  n:=jsonb_array_length(coalesce(nullif(p->'chunks','null'::jsonb),'[]'));
  SELECT * INTO d FROM app.knowledge_document WHERE workspace_id=p_ws AND source_url=p->>'url' FOR UPDATE;
  IF EXISTS(SELECT 1 FROM app.knowledge_document o WHERE o.workspace_id=p_ws AND o.sha256=p->>'sha256' AND o.state<>'archived' AND o.id IS DISTINCT FROM d.id)
   OR (n>0 AND (SELECT count(*) FROM app.knowledge_chunk c WHERE c.workspace_id=p_ws AND c.document_id IS DISTINCT FROM d.id)+n>20000)
   OR (d.id IS NULL AND (n=0 OR (SELECT count(*) FROM app.knowledge_document WHERE workspace_id=p_ws AND state<>'archived')>=50)) THEN
   skipped:=skipped+1;CONTINUE;
  END IF;
  IF d.id IS NULL THEN
   INSERT INTO app.knowledge_document(workspace_id,title,mime,bytes,sha256,blob_key,uploaded_by,source_url,state,approved_by,approved_at)
    VALUES(p_ws,left(p->>'title',200),'text/html',(p->>'bytes')::bigint,p->>'sha256','site:'||md5(p->>'url'),p_user,p->>'url','approved',p_user,clock_timestamp()) RETURNING * INTO d;
   added:=added+1;
  ELSIF n>0 THEN
   UPDATE app.knowledge_document SET title=left(p->>'title',200),bytes=(p->>'bytes')::bigint,sha256=p->>'sha256',state='approved',error=NULL,
    approved_by=p_user,approved_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=d.id;
   updated:=updated+1;
  ELSIF d.state<>'approved' THEN
   UPDATE app.knowledge_document SET state='approved',approved_by=p_user,approved_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=d.id;
  END IF;
  IF n>0 THEN
   DELETE FROM app.knowledge_chunk WHERE workspace_id=p_ws AND document_id=d.id;
   INSERT INTO app.knowledge_chunk(workspace_id,document_id,ordinal,label,text,embedding,tsv)
    SELECT p_ws,d.id,(c->>'ordinal')::integer,left(c->>'label',200),c->>'text',(c->>'embedding')::public.vector,
     to_tsvector('portuguese'::regconfig,public.unaccent(coalesce(c->>'label','')||' '||(c->>'text')))
    FROM jsonb_array_elements(p->'chunks') c;
   UPDATE app.knowledge_document SET pages=1,chunks=n,usage=coalesce(p->'usage','{}') WHERE workspace_id=p_ws AND id=d.id;
  END IF;
 END LOOP;
 DELETE FROM app.knowledge_document WHERE workspace_id=p_ws AND source_url IS NOT NULL
  AND source_url NOT IN(SELECT e->>'url' FROM jsonb_array_elements(p_pages) e);
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN jsonb_build_object('added',added,'updated',updated,'skipped',skipped,'removed',removed);
END $$;

-- Search: an agent that reads the base also reads every site page, including pages added by later rereads.
CREATE OR REPLACE FUNCTION app.knowledge_search(p_ws text,p_documents text[],p_embedding public.vector,p_query text,p_k integer)
RETURNS TABLE(id text,document_id text,title text,label text,text text,vector_rank integer,text_rank integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 SET LOCAL hnsw.iterative_scan=relaxed_order;
 RETURN QUERY
 WITH docs AS (SELECT d.id,d.title FROM app.knowledge_document d WHERE d.workspace_id=p_ws AND d.state='approved' AND (d.id=ANY(p_documents) OR (d.source_url IS NOT NULL AND cardinality(p_documents)>0))),
 v AS (SELECT c.document_id,c.ordinal,row_number() OVER (ORDER BY c.embedding<=>p_embedding)::integer r FROM app.knowledge_chunk c
   WHERE p_embedding IS NOT NULL AND c.workspace_id=p_ws AND c.document_id IN(SELECT docs.id FROM docs) ORDER BY c.embedding<=>p_embedding LIMIT least(p_k,50)),
 t AS (SELECT c.document_id,c.ordinal,row_number() OVER (ORDER BY ts_rank(c.tsv,q) DESC)::integer r FROM app.knowledge_chunk c,websearch_to_tsquery('portuguese'::regconfig,public.unaccent(coalesce(p_query,''))) q
   WHERE coalesce(p_query,'')<>'' AND c.workspace_id=p_ws AND c.document_id IN(SELECT docs.id FROM docs) AND c.tsv@@q ORDER BY ts_rank(c.tsv,q) DESC LIMIT least(p_k,50))
 SELECT c.document_id||':'||c.ordinal,c.document_id,docs.title,c.label,c.text,v.r,t.r
 FROM app.knowledge_chunk c JOIN docs ON docs.id=c.document_id
 LEFT JOIN v ON v.document_id=c.document_id AND v.ordinal=c.ordinal LEFT JOIN t ON t.document_id=c.document_id AND t.ordinal=c.ordinal
 WHERE c.workspace_id=p_ws AND (v.r IS NOT NULL OR t.r IS NOT NULL);
END $$;

REVOKE ALL ON FUNCTION app.knowledge_site_pages(text),app.knowledge_sync_site(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.knowledge_site_pages(text),app.knowledge_sync_site(text,text,jsonb) TO cadence_worker;
