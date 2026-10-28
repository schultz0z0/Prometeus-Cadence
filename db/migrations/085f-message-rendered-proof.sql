CREATE FUNCTION app.render_authored_message(p_template text,p_lead jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE rest text:=COALESCE(p_template,'');result text:='';m text[];at integer;k text;value text;
BEGIN
 LOOP
  m:=regexp_match(rest,'(\{\{\s*([^{}]+?)\s*\}\})');EXIT WHEN m IS NULL;
  at:=strpos(rest,m[1]);k:=btrim(m[2]);value:=p_lead->>CASE k WHEN 'nome' THEN 'name' WHEN 'email' THEN 'email' WHEN 'telefone' THEN 'phone' WHEN 'site' THEN 'site' WHEN 'cidade' THEN 'city' WHEN 'razaoSocial' THEN 'companyName' WHEN 'cnpj' THEN 'cnpj' ELSE '' END;
  IF value IS NULL OR value='' THEN RAISE EXCEPTION 'AUTHORING_VARIABLE_UNRESOLVED';END IF;
  result:=result||left(rest,at-1)||value;rest:=substr(rest,at+length(m[1]));
 END LOOP;RETURN result||rest;
END $$;
REVOKE ALL ON FUNCTION app.render_authored_message(text,jsonb) FROM PUBLIC;
CREATE FUNCTION app.guard_authored_rendered_content() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE recipient jsonb;entry record;s jsonb;selected jsonb;facts jsonb;rendered text;subject text;preview text;parity integer;ch text;expected_variant text;box_signature text;
BEGIN
 IF NEW.snapshot->>'version'<>'2' THEN RETURN NEW;END IF;
 FOR recipient IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.snapshot->'recipients','[]')) LOOP
  FOR entry IN SELECT * FROM jsonb_each(COALESCE(recipient->'steps','{}')) LOOP
   SELECT value INTO s FROM jsonb_array_elements(NEW.snapshot->'cadence'->'steps') WHERE value->>'id'=entry.key;
   IF NOT(s ? 'variantB') AND jsonb_array_length(COALESCE(s->'attachmentIds','[]'))=0 THEN CONTINUE;END IF;
   SELECT payload INTO facts FROM app.lead WHERE workspace_id=NEW.workspace_id AND id=recipient->>'leadId';
   IF facts IS NULL OR facts IS DISTINCT FROM NEW.snapshot->'recipientFacts'->(recipient->>'leadId') THEN RAISE EXCEPTION 'AUTHORING_FACTS_CHANGED';END IF;
   IF COALESCE(recipient->>'enrollmentId','')!~'^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'AUTHORING_VARIANT_REQUIRED';END IF;
   parity:=1;FOR ch IN SELECT regexp_split_to_table(recipient->>'enrollmentId','') LOOP parity:=(parity # ascii(ch)) & 1;END LOOP;
   expected_variant:=CASE WHEN s ? 'variantB' AND parity=1 THEN 'B' ELSE 'A' END;
   IF entry.value->>'variant' IS DISTINCT FROM expected_variant THEN RAISE EXCEPTION 'AUTHORING_VARIANT_CHANGED';END IF;
   selected:=CASE WHEN expected_variant='B' THEN s->'variantB' ELSE s END;
   IF COALESCE(btrim(selected->>'body'),'')='' THEN RAISE EXCEPTION 'AUTHORING_BODY_REQUIRED';END IF;
   rendered:=app.render_authored_message(selected->>'body',facts);
   IF entry.value->'content'->>'text' IS DISTINCT FROM rendered THEN RAISE EXCEPTION 'AUTHORING_RENDERED_CONTENT_CHANGED';END IF;
   IF s->>'channel'='EMAIL' THEN
    subject:=app.render_authored_message(selected->>'subject',facts);
    SELECT b.signature INTO box_signature FROM app.channel_sender sender JOIN app.email_mailbox b ON b.workspace_id=sender.workspace_id AND b.id=sender.connection_id WHERE sender.workspace_id=NEW.workspace_id AND sender.id=entry.value->'sender'->>'id';
    IF COALESCE(btrim(subject),'')='' OR entry.value->'content'->>'kind' IS DISTINCT FROM 'email' OR entry.value->'content'->>'subject' IS DISTINCT FROM subject OR box_signature IS NULL OR entry.value->'content'->>'signature' IS DISTINCT FROM box_signature THEN RAISE EXCEPTION 'AUTHORING_RENDERED_CONTENT_CHANGED';END IF;
    preview:=subject||E'\n\n'||rendered||CASE WHEN box_signature<>'' THEN E'\n\n'||box_signature ELSE '' END||CASE WHEN COALESCE(entry.value->'unsubscribe'->>'url','')<>'' THEN E'\n\nPara não receber mais e-mails: '||(entry.value->'unsubscribe'->>'url') ELSE '' END;
   ELSE
    IF entry.value->'content'->>'kind' IS DISTINCT FROM 'text' THEN RAISE EXCEPTION 'AUTHORING_VARIANT_TEMPLATE_UNSUPPORTED';END IF;preview:=rendered;
   END IF;
   IF entry.value->>'preview' IS DISTINCT FROM preview THEN RAISE EXCEPTION 'AUTHORING_PREVIEW_CHANGED';END IF;
  END LOOP;
 END LOOP;RETURN NEW;
END $$;
CREATE TRIGGER authored_rendered_content BEFORE INSERT ON app.cadence_publication FOR EACH ROW EXECUTE FUNCTION app.guard_authored_rendered_content();
