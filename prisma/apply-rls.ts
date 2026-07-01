import { PrismaClient } from "@prisma/client";

/**
 * RLS bootstrap. Applies row-level security with organisational predicates.
 *
 * Architecture:
 *   - `porterapp` role: connects with the runtime DATABASE_URL. Subject to RLS.
 *   - `<admin>` role (whatever ran this script): superuser/owner with implicit
 *     BYPASSRLS. Used by migrations and by the runtime via DATABASE_ADMIN_URL
 *     for the worker and admin routes.
 *
 * Session variables read by the policies:
 *   - app.current_org_id  — set by withOrgContext() before each user-facing tx.
 *     Empty when unset, which makes every predicate fail safely.
 *   - app.current_user_id — optional; used only by the User-self-read policy.
 *
 * Idempotent: every statement is safe to re-run.
 */

const prisma = new PrismaClient();

async function exec(sql: string) {
  await prisma.$executeRawUnsafe(sql);
}

async function enableRls(table: string) {
  await exec(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
  // Do NOT FORCE: we want table owners (migrations, seed, the admin
  // role used for DATABASE_ADMIN_URL) to bypass RLS implicitly. Non-owner
  // roles like `porterapp` are still subject to RLS via the policies below.
  await exec(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
}

async function dropPolicy(table: string, name: string) {
  await exec(`DROP POLICY IF EXISTS ${name} ON "${table}"`);
}

async function createPolicy(table: string, name: string, operation: string, clause: string) {
  await dropPolicy(table, name);
  await exec(`CREATE POLICY ${name} ON "${table}" FOR ${operation} ${clause}`);
}

async function main() {
  // ── Helper functions ──────────────────────────────────────────────────────
  // current_setting(..., true) returns '' when the var is unset, which makes
  // every comparison below false — fail-safe default.
  await exec(`
    CREATE OR REPLACE FUNCTION current_app_org() RETURNS text AS $$
      SELECT NULLIF(current_setting('app.current_org_id', true), '')
    $$ LANGUAGE sql STABLE
  `);
  await exec(`
    CREATE OR REPLACE FUNCTION current_app_user() RETURNS text AS $$
      SELECT NULLIF(current_setting('app.current_user_id', true), '')
    $$ LANGUAGE sql STABLE
  `);
  console.log("  helpers   current_app_org() / current_app_user() installed");

  // ── AuditLog: append-only ──────────────────────────────────────────────────
  await enableRls("AuditLog");
  await createPolicy("AuditLog", "audit_log_select", "SELECT", "USING (true)");
  await createPolicy("AuditLog", "audit_log_insert", "INSERT", "WITH CHECK (true)");
  // No UPDATE/DELETE policies → those operations are denied.
  console.log("  AuditLog  append-only");

  // ── User: own row + same-org siblings ──────────────────────────────────────
  // Without an org set, the policy denies everything (current_app_org() = NULL).
  await enableRls("User");
  await createPolicy("User", "user_select", "SELECT",
    `USING (
      id = current_app_user()
      OR "organizationId" IS NOT NULL AND "organizationId" = current_app_org()
    )`);
  await createPolicy("User", "user_insert", "INSERT", "WITH CHECK (true)");
  await createPolicy("User", "user_update", "UPDATE",
    `USING (id = current_app_user()) WITH CHECK (id = current_app_user())`);
  // DELETE: admin-only via BYPASSRLS — no policy.
  console.log("  User      self-read + same-org list");

  // ── Organization: own org only ─────────────────────────────────────────────
  await enableRls("Organization");
  await createPolicy("Organization", "org_select", "SELECT",
    `USING (id = current_app_org())`);
  // INSERT/UPDATE/DELETE: admin-only via BYPASSRLS.
  console.log("  Organization  own org only");

  // ── ProjectOrganization: current org's links only ──────────────────────────
  await enableRls("ProjectOrganization");
  await createPolicy("ProjectOrganization", "projorg_select", "SELECT",
    `USING ("organizationId" = current_app_org())`);
  // No INSERT/DELETE for porterapp — admins manage assignments via BYPASSRLS.
  console.log("  ProjectOrganization  own links only");

  // ── Project: linked to current org via ProjectOrganization ─────────────────
  await enableRls("Project");
  await createPolicy("Project", "project_select", "SELECT", `
    USING (EXISTS (
      SELECT 1 FROM "ProjectOrganization" po
      WHERE po."projectId" = "Project".id
        AND po."organizationId" = current_app_org()
    ))
  `);
  // INSERT/UPDATE/DELETE: admin via BYPASSRLS.
  console.log("  Project   linked-org SELECT");

  // ── Schema: visible if any of its projects links to current org ────────────
  await enableRls("Schema");
  await createPolicy("Schema", "schema_select", "SELECT", `
    USING (EXISTS (
      SELECT 1 FROM "SchemaProject" sp
      JOIN "ProjectOrganization" po ON po."projectId" = sp."projectId"
      WHERE sp."schemaId" = "Schema".id
        AND po."organizationId" = current_app_org()
    ))
  `);
  // Admin-only mutations via BYPASSRLS.
  console.log("  Schema    linked-org SELECT");

  // ── SchemaProject: filter by linked org via ProjectOrganization ────────────
  await enableRls("SchemaProject");
  await createPolicy("SchemaProject", "schemaproj_select", "SELECT", `
    USING (EXISTS (
      SELECT 1 FROM "ProjectOrganization" po
      WHERE po."projectId" = "SchemaProject"."projectId"
        AND po."organizationId" = current_app_org()
    ))
  `);
  console.log("  SchemaProject  linked-org SELECT");

  // ── SchemaColumn: inherit visibility from parent schema ───────────────────
  await enableRls("SchemaColumn");
  await createPolicy("SchemaColumn", "schemacol_select", "SELECT", `
    USING (EXISTS (
      SELECT 1 FROM "Schema" s
      JOIN "SchemaProject" sp ON sp."schemaId" = s.id
      JOIN "ProjectOrganization" po ON po."projectId" = sp."projectId"
      WHERE s.id = "SchemaColumn"."schemaId"
        AND po."organizationId" = current_app_org()
    ))
  `);
  console.log("  SchemaColumn  inherited SELECT");

  // ── FileUpload: filter by uploader's organization ──────────────────────────
  // INSERT/UPDATE require the inserted/updated row's userId to be in the
  // current org — defence-in-depth against an authenticated user planting
  // rows under another org's user id.
  await enableRls("FileUpload");
  const fileUploadOrgCheck = `
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "FileUpload"."userId"
        AND u."organizationId" = current_app_org()
    )
  `;
  await createPolicy("FileUpload", "fileupload_select", "SELECT", `USING (${fileUploadOrgCheck})`);
  await createPolicy("FileUpload", "fileupload_insert", "INSERT", `WITH CHECK (${fileUploadOrgCheck})`);
  await createPolicy("FileUpload", "fileupload_update", "UPDATE",
    `USING (${fileUploadOrgCheck}) WITH CHECK (${fileUploadOrgCheck})`);
  await createPolicy("FileUpload", "fileupload_delete", "DELETE", `USING (${fileUploadOrgCheck})`);
  console.log("  FileUpload  org-scoped CRUD");

  // ── UploadRow: inherit isolation through FileUpload → User → Org ───────────
  await enableRls("UploadRow");
  const uploadRowOrgCheck = `
    EXISTS (
      SELECT 1 FROM "FileUpload" fu
      JOIN "User" u ON u.id = fu."userId"
      WHERE fu.id = "UploadRow"."uploadId"
        AND u."organizationId" = current_app_org()
    )
  `;
  await createPolicy("UploadRow", "uploadrow_select", "SELECT", `USING (${uploadRowOrgCheck})`);
  await createPolicy("UploadRow", "uploadrow_insert", "INSERT", `WITH CHECK (${uploadRowOrgCheck})`);
  await createPolicy("UploadRow", "uploadrow_delete", "DELETE", `USING (${uploadRowOrgCheck})`);
  // No UPDATE policy — rows are immutable.
  console.log("  UploadRow  org-scoped SELECT/INSERT/DELETE");

  // ── ValidationResult: same inheritance as UploadRow ────────────────────────
  await enableRls("ValidationResult");
  const validationOrgCheck = `
    EXISTS (
      SELECT 1 FROM "FileUpload" fu
      JOIN "User" u ON u.id = fu."userId"
      WHERE fu.id = "ValidationResult"."uploadId"
        AND u."organizationId" = current_app_org()
    )
  `;
  await createPolicy("ValidationResult", "valresult_select", "SELECT", `USING (${validationOrgCheck})`);
  await createPolicy("ValidationResult", "valresult_insert", "INSERT", `WITH CHECK (${validationOrgCheck})`);
  await createPolicy("ValidationResult", "valresult_delete", "DELETE", `USING (${validationOrgCheck})`);
  console.log("  ValidationResult  org-scoped SELECT/INSERT/DELETE");

  // ── Classification & AppSetting: admin-managed, no porterapp access ────────
  // RLS enabled with no policies → all operations denied for porterapp.
  // Admin role bypasses via BYPASSRLS.
  await enableRls("Classification");
  await dropPolicy("Classification", "classification_select");
  await dropPolicy("Classification", "classification_insert");
  await dropPolicy("Classification", "classification_update");
  await dropPolicy("Classification", "classification_delete");
  // Classifications are referenced by SchemaColumn for validation — expose
  // read-only to porterapp so the upload pipeline can resolve allowed values.
  await createPolicy("Classification", "classification_select", "SELECT", "USING (true)");
  console.log("  Classification  read-only");

  await enableRls("AppSetting");
  await dropPolicy("AppSetting", "appsetting_select");
  await dropPolicy("AppSetting", "appsetting_insert");
  await dropPolicy("AppSetting", "appsetting_update");
  await dropPolicy("AppSetting", "appsetting_delete");
  // AppSetting holds SSO config read at runtime — expose read-only.
  await createPolicy("AppSetting", "appsetting_select", "SELECT", "USING (true)");
  console.log("  AppSetting  read-only");

  // ── AuthToken: admin-only, fully denied to porterapp ───────────────────────
  // Invite / reset / MFA-enrollment tokens are created and consumed exclusively
  // through prismaAdmin (the auth flows run before any org/user context exists).
  // Enable RLS with no policies so the runtime porterapp role can never read or
  // write password-reset tokens; the owner/admin role bypasses via BYPASSRLS.
  await enableRls("AuthToken");
  await dropPolicy("AuthToken", "authtoken_select");
  await dropPolicy("AuthToken", "authtoken_insert");
  await dropPolicy("AuthToken", "authtoken_update");
  await dropPolicy("AuthToken", "authtoken_delete");
  console.log("  AuthToken  admin-only (no porterapp access)");

  console.log("\nAll RLS policies applied.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
