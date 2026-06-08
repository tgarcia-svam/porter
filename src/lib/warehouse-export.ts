/**
 * Data-warehouse export orchestrator.
 *
 * After an upload finalizes VALID, its validated rows (already persisted to
 * UploadRow.data) are written as a typed Parquet file into the external
 * warehouse landing zone. This runs best-effort: any failure is recorded on the
 * FileUpload export-tracking fields and never propagates to the caller, so a
 * warehouse outage can't flip a VALID upload or break the upload response.
 *
 * Idempotent: the blob is keyed by uploadId, so a Service Bus redelivery (or a
 * manual re-run) overwrites the same file rather than duplicating warehouse rows.
 *
 *   {rootPath}/{schemaName}/dt=YYYY-MM-DD/{uploadId}.parquet
 *
 * Typing comes from SchemaColumn.dataType (DB rows are all strings; empty cells
 * become null). See the DataType enum in prisma/schema.prisma.
 */

import { PassThrough } from "node:stream";
import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import type { DataType } from "@prisma/client";
import { prismaAdmin } from "./prisma-admin";
import { sanitizePathSegment } from "./upload-service";
import { isManagedIdentityConfigured, uploadParquetToWarehouse } from "./warehouse-storage";
import { getWarehouseExportConfig } from "./warehouse-export-service";

// Read rows from the DB in bounded pages to keep memory flat for large uploads.
const ROW_PAGE_SIZE = 5_000;

type ParquetFieldType = "UTF8" | "DOUBLE" | "INT64" | "BOOLEAN";

/** Map a schema column's DataType to the Parquet physical/logical type used. */
function parquetTypeFor(dataType: DataType): ParquetFieldType {
  switch (dataType) {
    case "NUMBER":
      return "DOUBLE";
    case "INTEGER":
      return "INT64";
    case "BOOLEAN":
      return "BOOLEAN";
    // TEXT, EMAIL, DATE — DATE is exported as its ISO-8601 string (validate.ts
    // already normalizes dates), which every warehouse can cast on ingest.
    default:
      return "UTF8";
  }
}

/**
 * Coerce a stored string cell into the typed Parquet value. Empty/absent cells
 * become null. Unparseable values for a typed column also become null rather
 * than failing the whole export (the row already passed validation, so this is
 * defensive only).
 */
function coerceCell(raw: string | undefined, type: ParquetFieldType): unknown {
  if (raw === undefined || raw === "") return null;
  switch (type) {
    case "DOUBLE": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case "INT64": {
      try {
        // INT64 fields require BigInt input in parquetjs.
        return BigInt(raw.trim());
      } catch {
        const n = Number(raw);
        return Number.isInteger(n) ? BigInt(n) : null;
      }
    }
    case "BOOLEAN": {
      const v = raw.trim().toLowerCase();
      if (["true", "1", "yes", "y", "t"].includes(v)) return true;
      if (["false", "0", "no", "n", "f"].includes(v)) return false;
      return null;
    }
    default:
      return raw;
  }
}

/** Build the deterministic warehouse blob path for an upload. */
function buildExportBlobName(opts: {
  rootPath: string;
  schemaName: string;
  uploadId: string;
  createdAt: Date;
}): string {
  const date = opts.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD
  const schemaSegment = sanitizePathSegment(opts.schemaName);
  const root = opts.rootPath ? `${opts.rootPath}/` : "";
  return `${root}${schemaSegment}/dt=${date}/${opts.uploadId}.parquet`;
}

/**
 * Build a Parquet buffer for an upload's rows, typed by its schema columns.
 * Reads UploadRow records in pages so memory stays bounded.
 */
async function buildParquetBuffer(
  uploadId: string,
  columns: Array<{ name: string; dataType: DataType }>
): Promise<Buffer> {
  const fields: Record<string, { type: ParquetFieldType; optional: true }> = {};
  for (const col of columns) {
    fields[col.name] = { type: parquetTypeFor(col.dataType), optional: true };
  }
  const schema = new ParquetSchema(fields);

  const chunks: Buffer[] = [];
  const sink = new PassThrough();
  sink.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    sink.on("end", resolve);
    sink.on("error", reject);
  });

  // parquetjs types openStream against fs.WriteStream, but only uses write/end;
  // a PassThrough satisfies that at runtime (verified), so cast to the param type.
  const writer = await ParquetWriter.openStream(
    schema,
    sink as unknown as Parameters<typeof ParquetWriter.openStream>[1]
  );

  let skip = 0;
  for (;;) {
    const page = await prismaAdmin.uploadRow.findMany({
      where: { uploadId },
      orderBy: { rowIndex: "asc" },
      skip,
      take: ROW_PAGE_SIZE,
      select: { data: true },
    });
    if (page.length === 0) break;

    for (const { data } of page) {
      const row = (data ?? {}) as Record<string, string>;
      const record: Record<string, unknown> = {};
      for (const col of columns) {
        record[col.name] = coerceCell(row[col.name], parquetTypeFor(col.dataType));
      }
      await writer.appendRow(record);
    }

    if (page.length < ROW_PAGE_SIZE) break;
    skip += ROW_PAGE_SIZE;
  }

  await writer.close();
  await finished;
  return Buffer.concat(chunks);
}

/**
 * Export a single VALID upload to the warehouse landing zone. Best-effort:
 * returns a result object and never throws. No-op (returns skipped) when export
 * is disabled, credentials are absent, the upload isn't VALID, or it has no rows.
 */
export async function exportUploadToWarehouse(
  uploadId: string
): Promise<{ status: "exported" | "skipped" | "failed"; reason?: string; path?: string }> {
  try {
    const config = await getWarehouseExportConfig();
    if (!config.enabled) return { status: "skipped", reason: "disabled" };
    if (!config.accountUrl || !config.tenantId || !config.clientId) {
      return { status: "skipped", reason: "connection_not_configured" };
    }
    if (!config.container) return { status: "skipped", reason: "no_container" };
    if (!isManagedIdentityConfigured()) {
      return { status: "skipped", reason: "managed_identity_not_configured" };
    }

    const upload = await prismaAdmin.fileUpload.findUnique({
      where: { id: uploadId },
      select: { id: true, status: true, schemaId: true, createdAt: true },
    });
    if (!upload) return { status: "skipped", reason: "upload_not_found" };
    if (upload.status !== "VALID") return { status: "skipped", reason: "not_valid" };

    const schema = await prismaAdmin.schema.findUnique({
      where: { id: upload.schemaId },
      include: { columns: { orderBy: { order: "asc" } } },
    });
    if (!schema) return { status: "skipped", reason: "schema_not_found" };

    const columns = schema.columns.map((c) => ({ name: c.name, dataType: c.dataType }));
    if (columns.length === 0) return { status: "skipped", reason: "no_columns" };

    const buffer = await buildParquetBuffer(uploadId, columns);

    const blobName = buildExportBlobName({
      rootPath: config.rootPath,
      schemaName: schema.name,
      uploadId,
      createdAt: upload.createdAt,
    });

    await uploadParquetToWarehouse(
      { accountUrl: config.accountUrl, tenantId: config.tenantId, clientId: config.clientId },
      config.container,
      blobName,
      buffer
    );

    await prismaAdmin.fileUpload.update({
      where: { id: uploadId },
      data: {
        exportStatus: "EXPORTED",
        exportedAt: new Date(),
        exportPath: blobName,
        exportError: null,
        exportAttempts: { increment: 1 },
      },
    });

    console.log(`[warehouse-export] uploadId=${uploadId} exported bytes=${buffer.byteLength} path=${blobName}`);
    return { status: "exported", path: blobName };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[warehouse-export] uploadId=${uploadId} FAILED:`, err);
    try {
      await prismaAdmin.fileUpload.update({
        where: { id: uploadId },
        data: {
          exportStatus: "FAILED",
          exportError: message.slice(0, 1000),
          exportAttempts: { increment: 1 },
        },
      });
    } catch (updateErr) {
      console.error(`[warehouse-export] uploadId=${uploadId} could not record failure:`, updateErr);
    }
    return { status: "failed", reason: message };
  }
}
