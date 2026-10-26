-- Nullable historical values preserve existing users; new accounts complete enrollment.
ALTER TABLE auth."user"
 ADD COLUMN "phoneNumber" text,
 ADD COLUMN "termsVersion" text,
 ADD COLUMN "privacyVersion" text,
 ADD COLUMN "legalAcceptedAt" timestamptz,
 ADD COLUMN "registrationRequired" boolean NOT NULL DEFAULT false;
ALTER TABLE auth."user" ADD CONSTRAINT registration_acceptance_complete CHECK (
 ("termsVersion" IS NULL AND "privacyVersion" IS NULL AND "legalAcceptedAt" IS NULL)
 OR ("termsVersion" IS NOT NULL AND "privacyVersion" IS NOT NULL AND "legalAcceptedAt" IS NOT NULL AND "phoneNumber" IS NOT NULL AND "phoneNumber" ~ '^\+[1-9][0-9]{7,14}$')
);
