/**
 * Creates / replaces / drops PostgreSQL views in the `reports` schema.
 *
 * View name pattern: reports.<sanitized_project>_<sanitized_file_format>
 *
 * Each view exposes:
 *   organization_name  – name of the uploading user's organization
 *   file_path          – blob storage URL of the source file
 *   <column>…          – one column per SchemaColumn, typed appropriately
 *
 * Rows are scoped to uploads that used the given schema AND whose uploader's
 * organization is assigned to the given project.
 */

type Column = { name: string; dataType: string };
type ProjectRef = { id: string; name: string };
type PrismaLike = { $executeRawUnsafe(sql: string): Promise<number> };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Produces a safe SQL identifier segment from an arbitrary string. */
function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** View name: <project>_<file_format>, stored in the `reports` schema. */
export function schemaViewName(projectName: string, schemaName: string): string {
  return `${sanitize(projectName)}_${sanitize(schemaName)}`;
}

/** Ensures the `reports` schema exists (idempotent). */
async function ensureReportsSchema(db: PrismaLike): Promise<void> {
  await db.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS reports`);
}

/**
 * SQL expression that extracts a typed value from the UploadRow JSON column.
 * Safe casts are used so a single bad row doesn't crash the whole view.
 */
function columnExpr(colName: string, dataType: string): string {
  const key = colName.replace(/'/g, "''");
  const raw = `ur."data"->>'${key}'`;

  switch (dataType) {
    case "NUMBER":
      return `(NULLIF(${raw}, ''))::numeric`;
    case "INTEGER":
      return `(NULLIF(${raw}, ''))::integer`;
    case "BOOLEAN":
      return (
        `CASE ` +
        `WHEN LOWER(${raw}) IN ('true','yes','1') THEN true ` +
        `WHEN LOWER(${raw}) IN ('false','no','0') THEN false ` +
        `ELSE NULL END`
      );
    case "DATE":
      return `(NULLIF(${raw}, ''))::timestamptz`;
    default:
      return raw; // TEXT, EMAIL → plain string
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * CREATE OR REPLACE the view for one (project, schema) pair.
 * Rows are filtered to uploads whose uploader's organization belongs to the project.
 */
export async function upsertSchemaView(
  db: PrismaLike,
  project: ProjectRef,
  schemaId: string,
  schemaName: string,
  columns: Column[]
): Promise<void> {
  const viewName = schemaViewName(project.name, schemaName);

  const columnLines = columns
    .map((col) => {
      const expr  = columnExpr(col.name, col.dataType);
      const alias = `"${col.name.replace(/"/g, '""')}"`;
      return `  ${expr} AS ${alias}`;
    })
    .join(",\n");

  // schemaId and project.id are cuids (alphanumeric) — safe to interpolate
  const sql = `
CREATE OR REPLACE VIEW "reports"."${viewName}" AS
SELECT
  org."name"    AS organization_name,
  fu."blobUrl"  AS file_path,
${columnLines}
FROM "UploadRow" ur
JOIN "FileUpload"    fu  ON ur."uploadId"       = fu.id
JOIN "User"          u   ON fu."userId"          = u.id
LEFT JOIN "Organization" org ON u."organizationId" = org.id
WHERE fu."schemaId" = '${schemaId}'
  AND u."organizationId" IN (
    SELECT "organizationId" FROM "ProjectOrganization" WHERE "projectId" = '${project.id}'
  )
`.trim();

  await db.$executeRawUnsafe(sql);
}

/**
 * CREATE OR REPLACE views for all (project, schema) pairs.
 * Ensures the `reports` schema exists once before creating views.
 */
export async function upsertAllSchemaViews(
  db: PrismaLike,
  projects: ProjectRef[],
  schemaId: string,
  schemaName: string,
  columns: Column[]
): Promise<void> {
  if (projects.length === 0) return;
  await ensureReportsSchema(db);
  await Promise.all(
    projects.map((p) => upsertSchemaView(db, p, schemaId, schemaName, columns))
  );
}

/**
 * DROP the view for one (project, schema) pair.
 */
export async function dropSchemaView(
  db: PrismaLike,
  projectName: string,
  schemaName: string
): Promise<void> {
  const viewName = schemaViewName(projectName, schemaName);
  await db.$executeRawUnsafe(`DROP VIEW IF EXISTS "reports"."${viewName}"`);
}

/**
 * DROP views for all (project, schema) pairs.
 */
export async function dropAllSchemaViews(
  db: PrismaLike,
  projects: ProjectRef[],
  schemaName: string
): Promise<void> {
  await Promise.all(projects.map((p) => dropSchemaView(db, p.name, schemaName)));
}
