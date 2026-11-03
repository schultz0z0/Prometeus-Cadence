-- 07A.0 review: expiry must be seen by a second gate check inside the same transaction (now() is frozen at transaction start).
CREATE OR REPLACE FUNCTION app.linkedin_capability_state() RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('adapterId',l.adapter_id,'kind',l.kind,'capabilities',l.capabilities,'expiresAt',l.expires_at,'verifiedAt',l.verified_at,'revision',l.revision,
  'state',CASE WHEN l.revoked_at IS NOT NULL THEN 'revoked' WHEN l.expires_at<=clock_timestamp() THEN 'expired' ELSE 'active' END)
 FROM app.linkedin_capability_profile l WHERE app.current_role() IS NOT NULL
 ORDER BY (l.revoked_at IS NULL) DESC,l.updated_at DESC LIMIT 1
$$;
