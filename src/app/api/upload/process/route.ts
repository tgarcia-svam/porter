/**
 * POST /api/upload/process
 *
 * Worker endpoint called by an Azure Function Service Bus trigger.
 * It receives the job message, runs malware scanning + validation + DB writes,
 * and updates the FileUpload record to VALID or INVALID when done.
 *
 * Authentication: shared secret header (UPLOAD_WORKER_SECRET env var).
 * The Azure Function must forward the header: X-Worker-Secret: <secret>
 *
 * The endpoint is intentionally not behind NextAuth session auth because it is
 * called by an Azure Function, not a browser.
 */

import { NextRequest, NextResponse } from "next/server";
// Worker has no user session — must bypass RLS to write across orgs.
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { validateFile } from "@/lib/validate";
import { waitForMalwareScanResult, deleteBlobByName, downloadBlobByName, isMalwareScanFailClosed } from "@/lib/azure-storage";
import type { UploadJobMessage } from "@/lib/service-bus";
import { apiUnauthorized, apiBadRequest, apiNotFound } from "@/lib/api-error";
import {
  resolveValidationColumns,
  toMissingColumnErrors,
  finalizeUpload,
} from "@/lib/upload-service";

// Allow up to 5 minutes — this endpoint does the heavy lifting
export const maxDuration = 300;

function verifyWorkerSecret(req: NextRequest): boolean {
  const secret = process.env.UPLOAD_WORKER_SECRET;
  if (!secret) {
    // If no secret is configured, deny all — don't allow unauthenticated processing
    return false;
  }
  return req.headers.get("x-worker-secret") === secret;
}

export async function POST(req: NextRequest) {
  if (!verifyWorkerSecret(req)) return apiUnauthorized();

  let message: UploadJobMessage;
  try {
    message = await req.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  const { uploadId, blobName, mimeType, sheetName } = message;
  if (!uploadId || !blobName || !mimeType) {
    return apiBadRequest("uploadId, blobName, and mimeType are required");
  }

  // Verify the record exists and is still PENDING
  const upload = await prisma.fileUpload.findUnique({
    where: { id: uploadId },
    select: { id: true, status: true, schemaId: true },
  });

  if (!upload) return apiNotFound("Upload record not found");
  if (upload.status !== "PENDING") {
    // Already processed (e.g. duplicate delivery) — idempotent no-op
    return NextResponse.json({ ok: true, skipped: true });
  }

  const t0 = Date.now();
  const elapsed = () => `${Date.now() - t0}ms`;
  console.log(`[process] uploadId=${uploadId} blob=${blobName} — started`);

  // ── Malware scan ──────────────────────────────────────────────────────────
  const tScan = Date.now();
  const scanResult = await waitForMalwareScanResult(blobName);
  console.log(`[process] malware scan: result=${scanResult} duration=${Date.now() - tScan}ms elapsed=${elapsed()}`);

  if (scanResult === "malicious") {
    await deleteBlobByName(blobName);
    await prisma.fileUpload.update({
      where: { id: uploadId },
      data: { status: "INVALID", errorCount: 1 },
    });
    await prisma.validationResult.create({
      data: {
        uploadId,
        row: 0,
        column: "",
        value: "",
        error: "File rejected: malware detected.",
      },
    });
    return NextResponse.json({ ok: true, status: "INVALID", reason: "malware" });
  }

  // Fail-closed: scan didn't complete in time. Leave the record PENDING and
  // return a non-2xx so the Azure Function throws and Service Bus redelivers
  // (up to maxDeliveryCount, then dead-letters). Each retry re-scans, giving
  // Defender more wall-clock time; an unscannable file is never marked VALID.
  if (scanResult === "pending" && isMalwareScanFailClosed()) {
    console.warn(`[process] scan still pending after timeout — holding for retry (uploadId=${uploadId})`);
    return NextResponse.json(
      { ok: false, reason: "scan_pending" },
      { status: 503 }
    );
  }

  // ── Fetch schema + classifications ────────────────────────────────────────
  const schema = await prisma.schema.findUnique({
    where: { id: upload.schemaId },
    include: { columns: { orderBy: { order: "asc" } } },
  });

  if (!schema) {
    await prisma.fileUpload.update({
      where: { id: uploadId },
      data: { status: "INVALID", errorCount: 1 },
    });
    return apiNotFound("Schema not found");
  }

  const columnsForValidation = await resolveValidationColumns(schema.columns);

  // ── Download blob ─────────────────────────────────────────────────────────
  const tDownload = Date.now();
  let buffer: Buffer;
  try {
    buffer = await downloadBlobByName(blobName);
    console.log(`[process] blob download: size=${buffer.byteLength}B duration=${Date.now() - tDownload}ms elapsed=${elapsed()}`);
  } catch (err) {
    console.error(`[process] blob download failed after ${Date.now() - tDownload}ms:`, err);
    await prisma.fileUpload.update({
      where: { id: uploadId },
      data: { status: "INVALID", errorCount: 1 },
    });
    await prisma.validationResult.create({
      data: { uploadId, row: 0, column: "", value: "", error: "Failed to read uploaded file from storage." },
    });
    return NextResponse.json({ ok: false, reason: "blob_download_failed" });
  }

  // ── Validate ──────────────────────────────────────────────────────────────
  const tValidate = Date.now();
  const { errors, errorsCapped, rowCount, missingColumns, rows } = await validateFile(
    buffer,
    mimeType,
    columnsForValidation,
    sheetName
  );
  console.log(`[process] validation: rows=${rowCount} errors=${errors.length} duration=${Date.now() - tValidate}ms elapsed=${elapsed()}`);

  const allErrors = [...toMissingColumnErrors(missingColumns), ...errors];

  // ── Persist results ───────────────────────────────────────────────────────
  const tDb = Date.now();
  const { status } = await finalizeUpload({
    uploadId,
    rowCount,
    errorsCapped,
    errors: allErrors,
    rows,
  });
  console.log(`[process] db writes: duration=${Date.now() - tDb}ms elapsed=${elapsed()}`);
  console.log(`[process] uploadId=${uploadId} complete: status=${status} rows=${rowCount} total=${elapsed()}`);

  // ── Data-warehouse export ───────────────────────────────────────────────────
  // Best-effort: never throws, records its own outcome on the FileUpload record.
  if (status === "VALID") {
    const tExport = Date.now();
    const exportResult = await exportUploadToWarehouse(uploadId);
    console.log(`[process] warehouse export: ${exportResult.status}${exportResult.reason ? ` (${exportResult.reason})` : ""} duration=${Date.now() - tExport}ms`);
  }

  return NextResponse.json({
    ok: true,
    status,
    rowCount,
    errorCount: allErrors.length,
  });
}
