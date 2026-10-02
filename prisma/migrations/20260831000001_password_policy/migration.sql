-- Password policy configuration (P408): configurable complexity, history,
-- minimum age, and custom dictionary — all managed via AppSetting.
-- This migration adds only the PasswordHistory table; AppSetting rows for the
-- new policy keys are created on first access via upsert in the admin routes.

CREATE TABLE IF NOT EXISTS "PasswordHistory" (
    "id"           TEXT         NOT NULL,
    "userId"       TEXT         NOT NULL,
    "passwordHash" TEXT         NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PasswordHistory_userId_createdAt_idx"
    ON "PasswordHistory"("userId", "createdAt" DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'PasswordHistory'
      AND constraint_name = 'PasswordHistory_userId_fkey'
  ) THEN
    ALTER TABLE "PasswordHistory"
      ADD CONSTRAINT "PasswordHistory_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
