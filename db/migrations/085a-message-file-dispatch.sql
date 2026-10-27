CREATE FUNCTION app.authoring_files_valid(p_ws text,p_files jsonb,p_channel text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE f jsonb;a app.message_attachment;total bigint:=0;
BEGIN
 IF p_files IS NULL OR jsonb_typeof(p_files)<>'array' OR jsonb_array_length(p_files)>5 THEN RETURN false;END IF;
 IF jsonb_array_length(p_files)>0 AND p_channel<>'EMAIL' THEN RETURN false;END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_files))<>jsonb_array_length(p_files) THEN RETURN false;END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_files) LOOP
  SELECT * INTO a FROM app.message_attachment WHERE workspace_id=p_ws AND id=f->>'id';
  IF NOT FOUND OR a.state<>'ready' OR a.hash IS DISTINCT FROM f->>'hash' OR a.mime IS DISTINCT FROM f->>'mime' OR a.name IS DISTINCT FROM f->>'name' OR a.size IS DISTINCT FROM (f->>'size')::integer THEN RETURN false;END IF;
  total:=total+a.size;
 END LOOP;RETURN total<=20971520;
END $$;
REVOKE ALL ON FUNCTION app.authoring_files_valid(text,jsonb,text) FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher;
DO $$ DECLARE definition text;needle text:=' content:=frozen->''content'';';target text:=' INSERT INTO app.message_outbox';BEGIN
 SELECT pg_get_functiondef('app.materialize_multichannel_enrollment(text,text)'::regprocedure) INTO definition;
 IF position(needle IN definition)=0 OR position(target IN definition)=0 THEN RAISE EXCEPTION 'AUTHORING_MATERIALIZER_CONTRACT_CHANGED';END IF;
 definition:=replace(definition,needle,' IF NOT app.authoring_files_valid(p_ws,COALESCE(frozen->''attachments'',''[]''::jsonb),a.channel) THEN UPDATE app.cadence_enrollment SET state=''blocked'',stop_reason=''ATTACHMENT_UNAVAILABLE'' WHERE workspace_id=p_ws AND id=e.id;RETURN 0;END IF;'||chr(10)||needle);
 definition:=replace(definition,target,' prepared:=prepared||jsonb_build_object(''attachments'',COALESCE(frozen->''attachments'',''[]''::jsonb),''variant'',frozen->''variant'',''contentRevision'',p.snapshot->''contentRevision'');'||chr(10)||target);
 EXECUTE definition;
END $$;

CREATE FUNCTION app.read_dispatch_attachments(p_ws text,p_message text,p_token text,p_fence bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.message_outbox;context jsonb;expected jsonb;result jsonb;
BEGIN
 context:=app.read_message_dispatch(p_ws,p_message,p_token,p_fence);IF context IS NULL OR context ? 'blocker' THEN RETURN NULL;END IF;
 SELECT * INTO o FROM app.message_outbox WHERE workspace_id=p_ws AND message_id=p_message AND lease_token=p_token AND fence=p_fence AND lease_until>clock_timestamp() AND state='pending';IF NOT FOUND THEN RETURN NULL;END IF;
 expected:=COALESCE(o.prepared_send->'attachments','[]');
 IF o.publication_id IS NOT NULL THEN
  IF expected IS DISTINCT FROM COALESCE((SELECT r->'steps'->(p.snapshot->'cadence'->'steps'->o.step_index->>'id')->'attachments' FROM app.cadence_publication p JOIN app.cadence_enrollment e ON e.workspace_id=p.workspace_id AND e.publication_id=p.id CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'recipients') r WHERE p.workspace_id=p_ws AND p.id=o.publication_id AND e.id=o.enrollment_id AND r->>'leadId'=e.lead_id),'[]') THEN RETURN NULL;END IF;
 END IF;
 IF NOT app.authoring_files_valid(p_ws,expected,o.prepared_send->>'channel') THEN RETURN NULL;END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'mime',a.mime,'size',a.size,'hash',a.hash,'key',a.storage_key) ORDER BY f.ordinality),'[]') INTO result FROM jsonb_array_elements(expected) WITH ORDINALITY f(value,ordinality) JOIN app.message_attachment a ON a.workspace_id=p_ws AND a.id=f.value->>'id';RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.read_dispatch_attachments(text,text,text,bigint) FROM PUBLIC,cadence_app,cadence_worker;
GRANT EXECUTE ON FUNCTION app.read_dispatch_attachments(text,text,text,bigint) TO cadence_dispatcher;

ALTER FUNCTION app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) RENAME TO begin_message_dispatch_pre_authoring;
CREATE FUNCTION app.begin_message_dispatch(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_guard jsonb,p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.read_dispatch_attachments(p_ws,p_message,p_token,p_fence) IS NULL THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'ATTACHMENT_AUTHORITY_CHANGED');RETURN jsonb_build_object('allowed',false,'code','ATTACHMENT_AUTHORITY_CHANGED');END IF;
 RETURN app.begin_message_dispatch_pre_authoring(p_ws,p_message,p_attempt,p_token,p_fence,p_guard,p_now);
END $$;
REVOKE ALL ON FUNCTION app.begin_message_dispatch_pre_authoring(text,text,text,text,bigint,jsonb,timestamptz),app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher;
GRANT EXECUTE ON FUNCTION app.begin_message_dispatch(text,text,text,text,bigint,jsonb,timestamptz) TO cadence_dispatcher;
