-- mfaExempt: per-user flag that allows login with password only (no MFA).
-- Intended for scanner/service accounts (e.g. Veracode dynamic scanning).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaExempt" BOOLEAN NOT NULL DEFAULT false;
