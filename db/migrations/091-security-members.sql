-- Better Auth1.7.12 getMigrations(...twoFactor) compile-only output,30/10/2026.
-- Explicit auth qualification and personal policy guards are product additions.
ALTER TABLE auth."user" ADD COLUMN "twoFactorEnabled" boolean DEFAULT false;
ALTER TABLE auth.session ADD COLUMN "twoFactorVerified" boolean DEFAULT false;
CREATE TABLE auth."twoFactor"(
 id text PRIMARY KEY,secret text NOT NULL,"backupCodes" text NOT NULL,
 "userId" text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
 verified boolean,"failedVerificationCount" integer,"lockedUntil" timestamptz
);
CREATE INDEX "twoFactor_secret_idx" ON auth."twoFactor"(secret);
CREATE UNIQUE INDEX "twoFactor_userId_idx" ON auth."twoFactor"("userId");
ALTER TABLE auth."user" ADD COLUMN security_epoch integer NOT NULL DEFAULT 0;
CREATE TABLE auth.security_challenge(
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
 session_id text NOT NULL,factor_id text NOT NULL,factor_hash text NOT NULL,security_epoch integer NOT NULL,
 expires_at timestamptz NOT NULL,verified_at timestamptz,attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(attempts BETWEEN 0 AND 5)
);
CREATE INDEX security_challenge_user ON auth.security_challenge(user_id,expires_at);
CREATE TABLE auth.totp_use(
 user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
 factor_hash text NOT NULL,code_hash text NOT NULL,used_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,factor_hash,code_hash)
);
ALTER TABLE auth.member ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE auth.invitation ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
CREATE TABLE auth.membership_request(
 workspace_id text NOT NULL REFERENCES auth.organization(id),request_id text NOT NULL,actor_id text NOT NULL REFERENCES auth."user"(id),
 input jsonb NOT NULL,result jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,request_id)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON auth."twoFactor",auth.security_challenge,auth.totp_use,auth.membership_request TO cadence_auth;
REVOKE ALL ON auth."twoFactor",auth.security_challenge,auth.totp_use,auth.membership_request FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing;

CREATE FUNCTION auth.guard_member_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF session_user='cadence_auth' AND OLD.role='owner' AND(TG_OP='DELETE' OR NEW.role<>'owner') THEN
  PERFORM pg_advisory_xact_lock(hashtext('members:'||OLD."organizationId"));
  IF NOT EXISTS(SELECT 1 FROM auth.member WHERE "organizationId"=OLD."organizationId" AND role='owner' AND id<>OLD.id) THEN RAISE EXCEPTION 'LAST_OWNER';END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NEW.role IS DISTINCT FROM OLD.role THEN NEW.revision:=OLD.revision+1;ELSE NEW.revision:=OLD.revision;END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_member_owner BEFORE DELETE OR UPDATE ON auth.member FOR EACH ROW EXECUTE FUNCTION auth.guard_member_owner();
CREATE FUNCTION auth.invitation_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN NEW.revision:=OLD.revision+1;RETURN NEW;END $$;
CREATE TRIGGER invitation_revision BEFORE UPDATE ON auth.invitation FOR EACH ROW EXECUTE FUNCTION auth.invitation_revision();

CREATE FUNCTION auth.invalidate_password_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW."providerId"='credential' AND NEW.password IS NOT NULL AND(TG_OP='INSERT' OR NEW.password IS DISTINCT FROM OLD.password) THEN
  UPDATE auth."user" SET security_epoch=security_epoch+1 WHERE id=NEW."userId";
  DELETE FROM auth.session WHERE "userId"=NEW."userId";
  DELETE FROM auth.security_challenge WHERE user_id=NEW."userId";
  DELETE FROM auth.verification WHERE value=NEW."userId" AND identifier LIKE '2fa-%';
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER invalidate_password_authority AFTER INSERT OR UPDATE OF password ON auth.account FOR EACH ROW EXECUTE FUNCTION auth.invalidate_password_authority();
REVOKE ALL ON FUNCTION auth.guard_member_owner(),auth.invitation_revision(),auth.invalidate_password_authority() FROM PUBLIC,cadence_app,cadence_worker,cadence_auth;
