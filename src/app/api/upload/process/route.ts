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
import { prisma } from "@/lib/prisma";
import { validateFile } from "@/lib/validate";
import { waitForMalwareScanResult, deleteBlobByName, downloadBlobByName } from "@/lib/azure-storage";
import type { UploadJobMessage } from "@/lib/service-bus";

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
  if (!verifyWorkerSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let message: UploadJobMessage;
  try {
    message = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { uploadId, blobName, mimeType, sheetName } = message;
  if (!uploadId || !blobName || !mimeType) {
    return NextResponse.json({ error: "uploadId, blobName, and mimeType are required" }, { status: 400 });
  }

  // Verify the record exists and is still PENDING
  const upload = await prisma.fileUpload.findUnique({
    where: { id: uploadId },
    select: { id: true, status: true, schemaId: true },
  });

  if (!upload) {
    return NextResponse.json({ error: "Upload record not found" }, { status: 404 });
  }
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
    return NextResponse.json({ error: "Schema not found" }, { status: 404 });
  }

  const classificationIds = schema.columns
    .map((c) => c.classificationId)
    .filter((id): id is string => id !== null && id !== undefined);

  const clsfs = classificationIds.length > 0
    ? await prisma.classification.findMany({
        where: { id: { in: classificationIds } },
        select: { id: true, values: true, caseSensitive: true },
      })
    : [];

  const classMap = new Map<string, { values: string[]; caseSensitive: boolean }>();
  for (const clf of clsfs) classMap.set(clf.id, { values: clf.values, caseSensitive: clf.caseSensitive });

  const columnsForValidation = schema.columns.map((c) => {
    const clf = c.classificationId ? classMap.get(c.classificationId) : null;
    return { ...c, allowedValues: clf?.values ?? null, caseSensitive: clf?.caseSensitive ?? null };
  });

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

  const missingColumnErrors = missingColumns.map((col) => ({
    row: 0,
    column: col,
    value: "",
    error: "Required column is missing from the file",
  }));

  const allErrors = [...missingColumnErrors, ...errors];
  const isValid = allErrors.length === 0;

  // ── Persist results ───────────────────────────────────────────────────────
  const tDb = Date.now();
  await prisma.fileUpload.update({
    where: { id: uploadId },
    data: {
      status: isValid ? "VALID" : "INVALID",
      errorCount: allErrors.length,
      rowCount,
      errorsCapped,
    },
  });

  if (allErrors.length > 0) {
    await prisma.validationResult.createMany({
      data: allErrors.map((e) => ({ ...e, uploadId })),
    });
  }

  // Insert valid rows — parallel chunks of 2 000 rows, 4 at a time
  const CHUNK_SIZE = 2_000;
  const CONCURRENCY = 4;
  if (isValid && rows.length > 0) {
    const chunks: Array<{ startIdx: number; data: typeof rows }> = [];
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      chunks.push({ startIdx: i, data: rows.slice(i, i + CHUNK_SIZE) });
    }
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      await Promise.all(
        chunks.slice(i, i + CONCURRENCY).map(({ startIdx, data }) =>
          prisma.uploadRow.createMany({
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
  console.log(`[process] db writes: duration=${Date.now() - tDb}ms elapsed=${elapsed()}`);
  console.log(`[process] uploadId=${uploadId} complete: status=${isValid ? "VALID" : "INVALID"} rows=${rowCount} total=${elapsed()}`);

  return NextResponse.json({
    ok: true,
    status: isValid ? "VALID" : "INVALID",
    rowCount,
    errorCount: allErrors.length,
  });
}
