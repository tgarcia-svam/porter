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

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
// Worker has no user session — must bypass RLS to write across orgs.
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { validateFile } from "@/lib/validate";
import { waitForMalwareScanResult, deleteBlobByName, downloadBlobByName, isMalwareScanFailClosed } from "@/lib/azure-storage";
import { exportUploadToWarehouse } from "@/lib/warehouse-export";
import type { UploadJobMessage } from "@/lib/service-bus";
import { apiUnauthorized, apiBadRequest, apiNotFound } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import {
  resolveValidationColumns,
  resolveSchemaComparisons,
  toMissingColumnErrors,
  finalizeUpload,
} from "@/lib/upload-service";

// Allow up to 5 minutes — this endpoint does the heavy lifting
export const maxDuration = 300;

function verifyWorkerSecret(req: NextRequest): boolean {
  const secret = process.env.UPLOAD_WORKER_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("x-worker-secret") ?? "";
  if (provided.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
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
  const elapsed = () => Date.now() - t0;
  logger.info("[process] started", { uploadId, blobName });

  // ── Malware scan ──────────────────────────────────────────────────────────
  const tScan = Date.now();
  const scanResult = await waitForMalwareScanResult(blobName);
  logger.info("[process] malware scan complete", { uploadId, scanResult, durationMs: Date.now() - tScan, elapsedMs: elapsed() });

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
    logger.warn("[process] scan still pending after timeout — holding for retry", { uploadId });
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

  const [columnsForValidation, comparisons] = await Promise.all([
    resolveValidationColumns(schema.columns),
    resolveSchemaComparisons(upload.schemaId),
  ]);

  // ── Download blob ─────────────────────────────────────────────────────────
  const tDownload = Date.now();
  let buffer: Buffer;
  try {
    buffer = await downloadBlobByName(blobName);
    logger.info("[process] blob download complete", { uploadId, sizeBytes: buffer.byteLength, durationMs: Date.now() - tDownload, elapsedMs: elapsed() });
  } catch (err) {
    logger.error("[process] blob download failed", err instanceof Error ? err : undefined, { uploadId, durationMs: Date.now() - tDownload });
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
    sheetName,
    blobName.split("/").pop(),
    comparisons,
  );
  logger.info("[process] validation complete", { uploadId, rowCount, errorCount: errors.length, durationMs: Date.now() - tValidate, elapsedMs: elapsed() });

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
  logger.info("[process] db writes complete", { uploadId, durationMs: Date.now() - tDb, elapsedMs: elapsed() });
  logger.info("[process] complete", { uploadId, status, rowCount, totalMs: elapsed() });

  // ── Data-warehouse export ───────────────────────────────────────────────────
  // Best-effort: never throws, records its own outcome on the FileUpload record.
  if (status === "VALID") {
    const tExport = Date.now();
    const exportResult = await exportUploadToWarehouse(uploadId);
    logger.info("[process] warehouse export", { uploadId, exportStatus: exportResult.status, reason: exportResult.reason ?? null, durationMs: Date.now() - tExport });
  }

  return NextResponse.json({
    ok: true,
    status,
    rowCount,
    errorCount: allErrors.length,
  });
}
