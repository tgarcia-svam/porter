import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Helper: enable RLS + FORCE on a table (idempotent — ALTER TABLE is safe to re-run)
async function enableRls(table: string) {
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
}

// Helper: create a policy only if it doesn't already exist
async function createPolicy(
  table: string,
  name: string,
  operation: string,
  clause: string  // USING(...) or WITH CHECK(...) or both
) {
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = '${table}' AND policyname = '${name}'
      ) THEN
        CREATE POLICY ${name} ON "${table}" FOR ${operation} ${clause};
      END IF;
    END $$
  `);
}

async function main() {
  // ── AuditLog ─────────────────────────────────────────────────────────────
  // Immutable append-only log: allow SELECT and INSERT, block UPDATE/DELETE.
  await enableRls("AuditLog");
  await createPolicy("AuditLog", "audit_log_select", "SELECT", "USING (true)");
  await createPolicy("AuditLog", "audit_log_insert", "INSERT", "WITH CHECK (true)");
  console.log("  AuditLog  — SELECT/INSERT allowed, UPDATE/DELETE blocked");

  // ── User ─────────────────────────────────────────────────────────────────
  // Full CRUD: app creates users on first SSO login, admins manage roles/lockout.
  await enableRls("User");
  await createPolicy("User", "user_select", "SELECT", "USING (true)");
  await createPolicy("User", "user_insert", "INSERT", "WITH CHECK (true)");
  await createPolicy("User", "user_update", "UPDATE", "USING (true) WITH CHECK (true)");
  await createPolicy("User", "user_delete", "DELETE", "USING (true)");
  console.log("  User      — full CRUD allowed");

  // ── Organization ─────────────────────────────────────────────────────────
  await enableRls("Organization");
  await createPolicy("Organization", "org_select", "SELECT", "USING (true)");
  await createPolicy("Organization", "org_insert", "INSERT", "WITH CHECK (true)");
  await createPolicy("Organization", "org_update", "UPDATE", "USING (true) WITH CHECK (true)");
  await createPolicy("Organization", "org_delete", "DELETE", "USING (true)");
  console.log("  Organization — full CRUD allowed");

  // ── Project ───────────────────────────────────────────────────────────────
  await enableRls("Project");
  await createPolicy("Project", "project_select", "SELECT", "USING (true)");
  await createPolicy("Project", "project_insert", "INSERT", "WITH CHECK (true)");
  await createPolicy("Project", "project_update", "UPDATE", "USING (true) WITH CHECK (true)");
  await createPolicy("Project", "project_delete", "DELETE", "USING (true)");
  console.log("  Project   — full CRUD allowed");

  // ── ProjectOrganization ───────────────────────────────────────────────────
  // Junction table: no UPDATE needed, just INSERT/SELECT/DELETE.
  await enableRls("ProjectOrganization");
  await createPolicy("ProjectOrganization", "projorg_select", "SELECT", "USING (true)");
  await createPolicy("ProjectOrganization", "projorg_insert", "INSERT", "WITH CHECK (true)");
  await createPolicy("ProjectOrganization", "projorg_delete", "DELETE", "USING (true)");
  console.log("  ProjectOrganization — SELECT/INSERT/DELETE allowed, UPDATE blocked");

  // ── Schema ────────────────────────────────────────────────────────────────
  await enableRls("Schema");
  await createPolicy("Schema", "schema_select", "SELECT", "USING (true)");
  await createPolicy("Schema", "schema_insert", "INSERT", "WITH CHECK (true)");
  await createPolicy("Schema", "schema_update", "UPDATE", "USING (true) WITH CHECK (true)");
  await createPolicy("Schema", "schema_delete", "DELETE", "USING (true)");
  console.log("  Schema    — full CRUD allowed");

  // ── SchemaProject ─────────────────────────────────────────────────────────
  // Junction table: no UPDATE needed.
  await enableRls("SchemaProject");
  await createPolicy("SchemaProject", "schemaproj_select", "SELECT", "USING (true)");
  await createPolicy("SchemaProject", "schemaproj_insert", "INSERT", "WITH CHECK (true)");
  await createPolicy("SchemaProject", "schemaproj_delete", "DELETE", "USING (true)");
  console.log("  SchemaProject — SELECT/INSERT/DELETE allowed, UPDATE blocked");

  // ── SchemaColumn ──────────────────────────────────────────────────────────
  await enableRls("SchemaColumn");
  await createPolicy("SchemaColumn", "schemacol_select", "SELECT", "USING (true)");
  await createPolicy("SchemaColumn", "schemacol_insert", "INSERT", "WITH CHECK (true)");
  await createPolicy("SchemaColumn", "schemacol_update", "UPDATE", "USING (true) WITH CHECK (true)");
  await createPolicy("SchemaColumn", "schemacol_delete", "DELETE", "USING (true)");
  console.log("  SchemaColumn — full CRUD allowed");

  // ── FileUpload ────────────────────────────────────────────────────────────
  // App inserts on upload, updates status after validation, deletes via cascade from Schema.
  await enableRls("FileUpload");
  await createPolicy("FileUpload", "fileupload_select", "SELECT", "USING (true)");
  await createPolicy("FileUpload", "fileupload_insert", "INSERT", "WITH CHECK (true)");
  await createPolicy("FileUpload", "fileupload_update", "UPDATE", "USING (true) WITH CHECK (true)");
  await createPolicy("FileUpload", "fileupload_delete", "DELETE", "USING (true)");
  console.log("  FileUpload — full CRUD allowed");

  // ── UploadRow ─────────────────────────────────────────────────────────────
  // Immutable raw data rows. UPDATE blocked; DELETE allowed for FK cascade.
  await enableRls("UploadRow");
  await createPolicy("UploadRow", "uploadrow_select", "SELECT", "USING (true)");
  await createPolicy("UploadRow", "uploadrow_insert", "INSERT", "WITH CHECK (true)");
  await createPolicy("UploadRow", "uploadrow_delete", "DELETE", "USING (true)");
  console.log("  UploadRow — SELECT/INSERT/DELETE allowed, UPDATE blocked");

  // ── ValidationResult ──────────────────────────────────────────────────────
  // Immutable validation output. UPDATE blocked; DELETE allowed for FK cascade.
  await enableRls("ValidationResult");
  await createPolicy("ValidationResult", "valresult_select", "SELECT", "USING (true)");
  await createPolicy("ValidationResult", "valresult_insert", "INSERT", "WITH CHECK (true)");
  await createPolicy("ValidationResult", "valresult_delete", "DELETE", "USING (true)");
  console.log("  ValidationResult — SELECT/INSERT/DELETE allowed, UPDATE blocked");

  // ── AppSetting ────────────────────────────────────────────────────────────
  await enableRls("AppSetting");
  await createPolicy("AppSetting", "appsetting_select", "SELECT", "USING (true)");
  await createPolicy("AppSetting", "appsetting_insert", "INSERT", "WITH CHECK (true)");
  await createPolicy("AppSetting", "appsetting_update", "UPDATE", "USING (true) WITH CHECK (true)");
  await createPolicy("AppSetting", "appsetting_delete", "DELETE", "USING (true)");
  console.log("  AppSetting — full CRUD allowed");

  console.log("\nAll RLS policies applied.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
