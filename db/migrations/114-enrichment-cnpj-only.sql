-- 06B.7: o Enriquecedor age em qualquer lead com CNPJ; a qualificação deixa de ser pré-requisito.
-- Reaproveita os corpos vigentes (080) e retira só a condição, falhando se o texto esperado não existir.
DO $$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('app.charge_enrichment_resolution()'::regprocedure);
 IF position($q$ AND l.payload->>'qualification'='qualified'$q$ IN d)=0 THEN RAISE EXCEPTION 'ENRICHMENT_RULE_NOT_FOUND charge';END IF;
 EXECUTE replace(d,$q$ AND l.payload->>'qualification'='qualified'$q$,'');
 d:=pg_get_functiondef('app.apply_enrichment(text,text[])'::regprocedure);
 IF position($q$source.payload->>'qualification'<>'qualified' OR $q$ IN d)=0 THEN RAISE EXCEPTION 'ENRICHMENT_RULE_NOT_FOUND apply';END IF;
 EXECUTE replace(d,$q$source.payload->>'qualification'<>'qualified' OR $q$,'');
 d:=pg_get_functiondef('app.billing_guard_job()'::regprocedure);
 IF position($q$ AND l.payload->>'qualification'='qualified'$q$ IN d)=0 THEN RAISE EXCEPTION 'ENRICHMENT_RULE_NOT_FOUND reserve';END IF;
 EXECUTE replace(d,$q$ AND l.payload->>'qualification'='qualified'$q$,'');
END
$$;
