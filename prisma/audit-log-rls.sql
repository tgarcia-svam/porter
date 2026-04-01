-- Enforce immutability on AuditLog via PostgreSQL Row-Level Security.
-- Rows can be inserted and read but never updated or deleted.
-- Executed on every container start (all statements are idempotent).

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;

-- Allow SELECT for all roles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'AuditLog' AND policyname = 'audit_log_select'
  ) THEN
    CREATE POLICY audit_log_select ON "AuditLog"
      FOR SELECT USING (true);
  END IF;
END $$;

-- Allow INSERT for all roles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'AuditLog' AND policyname = 'audit_log_insert'
  ) THEN
    CREATE POLICY audit_log_insert ON "AuditLog"
      FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- No UPDATE or DELETE policies are created.
-- When RLS is enabled, operations with no matching policy are denied by default.
