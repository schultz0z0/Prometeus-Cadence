-- 06B.7: partners found only in the registry are stored on the resolution without a contact.
-- They never consume an enrichment credit and never become decision-maker leads; only people with a published contact do.
DO $$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('app.charge_enrichment_resolution()'::regprocedure);
 IF position('IF jsonb_array_length(NEW.people)>0 THEN' IN d)=0 THEN RAISE EXCEPTION 'ENRICHMENT_RULE_NOT_FOUND charge';END IF;
 EXECUTE replace(d,'IF jsonb_array_length(NEW.people)>0 THEN',$q$IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.people) x WHERE x ? 'email' OR x ? 'phone') THEN$q$);
 d:=pg_get_functiondef('app.apply_enrichment(text,text[])'::regprocedure);
 IF position('IF NOT FOUND OR jsonb_array_length(r.people)=0 THEN' IN d)=0 OR position('FOR person IN SELECT value FROM jsonb_array_elements(r.people) LOOP' IN d)=0 THEN RAISE EXCEPTION 'ENRICHMENT_RULE_NOT_FOUND apply';END IF;
 d:=replace(d,'IF NOT FOUND OR jsonb_array_length(r.people)=0 THEN',$q$IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.people) x WHERE x ? 'email' OR x ? 'phone') THEN$q$);
 EXECUTE replace(d,'FOR person IN SELECT value FROM jsonb_array_elements(r.people) LOOP',$q$FOR person IN SELECT value FROM jsonb_array_elements(r.people) WHERE value ? 'email' OR value ? 'phone' LOOP$q$);
END
$$;
