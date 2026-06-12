/**
 * Shared upload pipeline helpers used by:
 *   - POST /api/upload          (inline upload)
 *   - POST /api/upload/manual   (manual data entry)
 *   - POST /api/upload/process  (async worker)
 *   - POST /api/upload/confirm  (SAS path)
 *
 * The pipeline has four stages, each represented by an exported helper:
 *   1. resolveValidationColumns — enrich SchemaColumn[] with classification values
 *   2. buildUploadBlobName     — partition blob storage by project/org/schema/datetime
 *   3. toMissingColumnErrors   — wrap required-but-absent column names into ValidationError shape
 *   4. createUploadWithResults / finalizeUpload — persist results, chunking large row sets
 *
 * Uses prismaAdmin throughout — the inline + manual routes are tagged
 * TODO(RLS) and currently bypass row-level security; the worker has no user
 * session and must bypass. When the user-facing write path is migrated to
 * withOrgContext(), these helpers can accept an optional tx client instead.
 */

import { prismaAdmin } from "./prisma-admin";
import type { ValidationError, ClassificationConstraint } from "./validate";

const ROW_CHUNK_SIZE = 2_000;
const ROW_CHUNK_CONCURRENCY = 4;

// ── Column / classification resolution ───────────────────────────────────────

export type ValidationColumn = {
  name: string;
  dataType: string;
  required: boolean;
  classification: ClassificationConstraint | null;
};

type ColumnWithClassification = {
  name: string;
  dataType: string;
  required: boolean;
  classificationId: string | null;
};

/** Format a date-only DB value as ISO "YYYY-MM-DD" (the validator's date format). */
function toIsoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * Inlines each column's classification constraint (value list, regex, number
 * range, or date range) from its referenced Classification, producing the shape
 * required by validateFile().
 *
 * Per repo convention, classifications are fetched in a separate query (not a
 * Prisma nested include) to avoid the type-inference loss that nested includes
 * can cause.
 */
export async function resolveValidationColumns(
  columns: ColumnWithClassification[]
): Promise<ValidationColumn[]> {
  const classificationIds = columns
    .map((c) => c.classificationId)
    .filter((id): id is string => id !== null && id !== undefined);

  if (classificationIds.length === 0) {
    return columns.map((c) => ({ ...c, classification: null }));
  }

  const clsfs = await prismaAdmin.classification.findMany({
    where: { id: { in: classificationIds } },
    select: {
      id: true,
      type: true,
      values: true,
      caseSensitive: true,
      pattern: true,
      minNumber: true,
      maxNumber: true,
      minDate: true,
      maxDate: true,
    },
  });

  const classMap = new Map(
    clsfs.map((c): [string, ClassificationConstraint] => [
      c.id,
      {
        type: c.type,
        values: c.values,
        caseSensitive: c.caseSensitive,
        pattern: c.pattern,
        minNumber: c.minNumber,
        maxNumber: c.maxNumber,
        minDate: toIsoDate(c.minDate),
        maxDate: toIsoDate(c.maxDate),
      },
    ])
  );

  return columns.map((c) => ({
    ...c,
    classification: c.classificationId ? classMap.get(c.classificationId) ?? null : null,
  }));
}

// ── Blob-path construction ───────────────────────────────────────────────────

/** Replace path-unsafe characters with underscores; empty string → "_". */
export function sanitizePathSegment(s: string): string {
  return s.replace(/[/\\?#%]/g, "_").trim() || "_";
}

/** Current time formatted as "YYYY-MM-DDTHH-MM-SS" (filesystem-safe). */
export function uploadDatetime(): string {
  return new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "");
}

/**
 * Build the blob storage key for an upload, partitioned by
 * project/org/schema/datetime. Pass `datetime` explicitly when the same
 * value needs to appear elsewhere (e.g. inside the filename for manual entries).
 */
export function buildUploadBlobName(opts: {
  projectNames: string[];
  orgName: string;
  schemaName: string;
  fileName: string;
  /** Optional top-level segment, e.g. "valid" / "error". */
  prefix?: string;
  /** Override the datetime segment. Defaults to uploadDatetime(). */
  datetime?: string;
}): { blobName: string; datetime: string } {
  const projectSegment =
    opts.projectNames.length > 0
      ? opts.projectNames.map(sanitizePathSegment).join("+")
      : "no-project";
  const orgSegment = sanitizePathSegment(opts.orgName);
  const schemaSegment = sanitizePathSegment(opts.schemaName);
  const datetime = opts.datetime ?? uploadDatetime();
  const prefixSegment = opts.prefix ? `${opts.prefix}/` : "";
  return {
    blobName: `${prefixSegment}${projectSegment}/${orgSegment}/${schemaSegment}/${datetime}/${opts.fileName}`,
    datetime,
  };
}

// ── Error wrapping ───────────────────────────────────────────────────────────

/** Convert a list of missing column names into ValidationError objects. */
export function toMissingColumnErrors(missingColumns: string[]): ValidationError[] {
  return missingColumns.map((col) => ({
    row: 0,
    column: col,
    value: "",
    error: "Required column is missing from the file",
  }));
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * Bulk-insert UploadRow records in parallel chunks (2 000 rows × 4 concurrent
 * inserts). Keeps memory bounded for large uploads while still leveraging
 * concurrency. rowIndex starts at 1.
 */
export async function insertUploadRows(
  uploadId: string,
  rows: Record<string, string>[]
): Promise<void> {
  if (rows.length === 0) return;

  const chunks: Array<{ startIdx: number; data: typeof rows }> = [];
  for (let i = 0; i < rows.length; i += ROW_CHUNK_SIZE) {
    chunks.push({ startIdx: i, data: rows.slice(i, i + ROW_CHUNK_SIZE) });
  }
  for (let i = 0; i < chunks.length; i += ROW_CHUNK_CONCURRENCY) {
    await Promise.all(
      chunks.slice(i, i + ROW_CHUNK_CONCURRENCY).map(({ startIdx, data }) =>
        prismaAdmin.uploadRow.createMany({
          data: data.map((row, j) => ({
            uploadId,
            rowIndex: startIdx + j + 1,
            data: row,
          })),
        })
      )
    );
  }
}

/**
 * Write ValidationResult rows and, if valid, UploadRow rows for an existing
 * FileUpload. The caller is responsible for the FileUpload status fields.
 */
async function writeValidationResults(opts: {
  uploadId: string;
  isValid: boolean;
  errors: ValidationError[];
  rows: Record<string, string>[];
}): Promise<void> {
  if (opts.errors.length > 0) {
    await prismaAdmin.validationResult.createMany({
      data: opts.errors.map((e) => ({ ...e, uploadId: opts.uploadId })),
    });
  }
  if (opts.isValid && opts.rows.length > 0) {
    await insertUploadRows(opts.uploadId, opts.rows);
  }
}

/**
 * Create a brand-new FileUpload and persist its validation results in one
 * pass. Used by routes that validate inline before any record exists
 * (POST /api/upload, /api/upload/manual).
 */
export async function createUploadWithResults(opts: {
  userId: string;
  schemaId: string;
  schemaVersion: number;
  fileName: string;
  blobUrl: string | null;
  rowCount: number;
  errorsCapped: boolean;
  errors: ValidationError[];
  rows: Record<string, string>[];
}): Promise<{ id: string; status: "VALID" | "INVALID" }> {
  const isValid = opts.errors.length === 0;
  const status: "VALID" | "INVALID" = isValid ? "VALID" : "INVALID";

  const record = await prismaAdmin.fileUpload.create({
    data: {
      userId: opts.userId,
      schemaId: opts.schemaId,
      schemaVersion: opts.schemaVersion,
      fileName: opts.fileName,
      blobUrl: opts.blobUrl,
      status,
      errorCount: opts.errors.length,
      rowCount: opts.rowCount,
      errorsCapped: opts.errorsCapped,
    },
  });

  await writeValidationResults({
    uploadId: record.id,
    isValid,
    errors: opts.errors,
    rows: opts.rows,
  });

  return { id: record.id, status };
}

/**
 * Update an existing PENDING FileUpload with validation results. Used by the
 * async worker (/api/upload/process) which receives a record that was created
 * up-front by the inline route.
 */
export async function finalizeUpload(opts: {
  uploadId: string;
  rowCount: number;
  errorsCapped: boolean;
  errors: ValidationError[];
  rows: Record<string, string>[];
}): Promise<{ status: "VALID" | "INVALID" }> {
  const isValid = opts.errors.length === 0;
  const status: "VALID" | "INVALID" = isValid ? "VALID" : "INVALID";

  await prismaAdmin.fileUpload.update({
    where: { id: opts.uploadId },
    data: {
      status,
      errorCount: opts.errors.length,
      rowCount: opts.rowCount,
      errorsCapped: opts.errorsCapped,
    },
  });

  await writeValidationResults({
    uploadId: opts.uploadId,
    isValid,
    errors: opts.errors,
    rows: opts.rows,
  });

  return { status };
}
