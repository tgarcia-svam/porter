import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Enable RLS and FORCE so it applies even to the table owner
  await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY`);

  // SELECT policy (idempotent)
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'AuditLog' AND policyname = 'audit_log_select'
      ) THEN
        CREATE POLICY audit_log_select ON "AuditLog" FOR SELECT USING (true);
      END IF;
    END $$
  `);

  // INSERT policy (idempotent)
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'AuditLog' AND policyname = 'audit_log_insert'
      ) THEN
        CREATE POLICY audit_log_insert ON "AuditLog" FOR INSERT WITH CHECK (true);
      END IF;
    END $$
  `);

  console.log("  AuditLog RLS policies applied (UPDATE/DELETE blocked)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
