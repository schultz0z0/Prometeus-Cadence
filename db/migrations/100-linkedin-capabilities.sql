-- 07A.0: platform-level LinkedIn adapter attestation. No workspace data; app roles reach it only through the functions below.
CREATE TABLE app.linkedin_capability_profile(
 adapter_id text PRIMARY KEY CHECK(adapter_id ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
 kind text NOT NULL CHECK(kind IN('official','account-connector')),
 agreement_ref text NOT NULL CHECK(length(agreement_ref) BETWEEN 3 AND 300),
 capabilities jsonb NOT NULL CHECK(jsonb_typeof(capabilities)='object'),
 evidence_refs jsonb NOT NULL CHECK(jsonb_typeof(evidence_refs)='object'),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 verified_by text NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 -- LinkedIn Messages API requires a specific member action and excludes scheduled sends (BR-001).
 CHECK(NOT(kind='official' AND capabilities->>'sendMessage'='automatic'))
);
CREATE UNIQUE INDEX linkedin_capability_one_active ON app.linkedin_capability_profile((true)) WHERE revoked_at IS NULL;
REVOKE ALL ON app.linkedin_capability_profile FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing;

CREATE FUNCTION app.linkedin_capability_state() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('adapterId',l.adapter_id,'kind',l.kind,'capabilities',l.capabilities,'expiresAt',l.expires_at,'verifiedAt',l.verified_at,'revision',l.revision,
  'state',CASE WHEN l.revoked_at IS NOT NULL THEN 'revoked' WHEN l.expires_at<=now() THEN 'expired' ELSE 'active' END)
 FROM app.linkedin_capability_profile l WHERE app.current_role() IS NOT NULL
 ORDER BY (l.revoked_at IS NULL) DESC,l.updated_at DESC LIMIT 1
$$;

CREATE FUNCTION app.attest_linkedin_adapter(p_scope text,p_adapter text,p_kind text,p_agreement text,p_caps jsonb,p_evidence jsonb,p_expires timestamptz,p_expected bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.linkedin_capability_profile;
BEGIN
 IF NOT app.platform_ai_authority(p_scope) THEN RAISE EXCEPTION 'PLATFORM_ADMIN_REQUIRED';END IF;
 IF p_expires<=now() OR p_expires>now()+interval '400 days' THEN RAISE EXCEPTION 'LINKEDIN_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('app.linkedin_capability_profile'));
 SELECT * INTO r FROM app.linkedin_capability_profile WHERE adapter_id=p_adapter FOR UPDATE;
 IF COALESCE(r.revision,0)<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 IF EXISTS(SELECT 1 FROM app.linkedin_capability_profile WHERE revoked_at IS NULL AND adapter_id<>p_adapter) THEN RAISE EXCEPTION 'ADAPTER_ACTIVE';END IF;
 INSERT INTO app.linkedin_capability_profile(adapter_id,kind,agreement_ref,capabilities,evidence_refs,expires_at,verified_by)
 VALUES(p_adapter,p_kind,p_agreement,p_caps,p_evidence,p_expires,current_setting('app.user_id'))
 ON CONFLICT(adapter_id) DO UPDATE SET kind=EXCLUDED.kind,agreement_ref=EXCLUDED.agreement_ref,capabilities=EXCLUDED.capabilities,evidence_refs=EXCLUDED.evidence_refs,
  expires_at=EXCLUDED.expires_at,verified_by=EXCLUDED.verified_by,revoked_at=NULL,revision=app.linkedin_capability_profile.revision+1,verified_at=now(),updated_at=now();
END$$;

CREATE FUNCTION app.revoke_linkedin_adapter(p_scope text,p_adapter text,p_expected bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT app.platform_ai_authority(p_scope) THEN RAISE EXCEPTION 'PLATFORM_ADMIN_REQUIRED';END IF;
 UPDATE app.linkedin_capability_profile SET revoked_at=now(),revision=revision+1,updated_at=now() WHERE adapter_id=p_adapter AND revision=p_expected AND revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
END$$;

REVOKE ALL ON FUNCTION app.linkedin_capability_state(),app.attest_linkedin_adapter(text,text,text,text,jsonb,jsonb,timestamptz,bigint),app.revoke_linkedin_adapter(text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.linkedin_capability_state() TO cadence_app,cadence_worker;
GRANT EXECUTE ON FUNCTION app.attest_linkedin_adapter(text,text,text,text,jsonb,jsonb,timestamptz,bigint),app.revoke_linkedin_adapter(text,text,bigint) TO cadence_app;
