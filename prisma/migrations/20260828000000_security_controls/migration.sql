-- SDElements security controls: T427/T428 (previous login notification),
-- T80/T2270 (password expiry), T429 (concurrent session limiting).

-- ── User: login tracking fields ───────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt"                  TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginIp"                  TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "prevLoginAt"                  TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "prevLoginIp"                  TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "failedAttemptsSinceLastLogin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt"            TIMESTAMP(3);

-- ── UserSession: concurrent session registry ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "UserSession" (
    "id"         TEXT        NOT NULL,
    "userId"     TEXT        NOT NULL,
    "tokenHash"  TEXT        NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress"  TEXT,
    "userAgent"  TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserSession_tokenHash_key" ON "UserSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "UserSession_userId_idx"     ON "UserSession"("userId");
CREATE INDEX IF NOT EXISTS "UserSession_lastSeenAt_idx" ON "UserSession"("lastSeenAt");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'UserSession' AND constraint_name = 'UserSession_userId_fkey'
  ) THEN
    ALTER TABLE "UserSession"
      ADD CONSTRAINT "UserSession_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
