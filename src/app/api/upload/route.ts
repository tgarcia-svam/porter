import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateFile } from "@/lib/validate";
import { uploadToBlob, waitForMalwareScanResult, deleteBlobByName } from "@/lib/azure-storage";
import { enqueueUploadJob, isServiceBusConfigured } from "@/lib/service-bus";
import { auditStore, clientIp } from "@/lib/audit-context";
import { verifySessionBinding } from "@/lib/session-binding";
import { logAuthEvent } from "@/lib/auth-audit";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiPayloadTooLarge,
  apiUnsupportedMediaType,
  apiUnprocessable,
  apiServiceUnavailable,
  withHandler,
} from "@/lib/api-error";

// Allow up to 5 minutes for large-file processing (inline fallback path only —
// the async Service Bus path returns in seconds).
export const maxDuration = 300;

export const POST = withHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();

  if (!verifySessionBinding(session.user.uaHash, req)) {
    logAuthEvent({
      action: "auth.session.invalid",
      userId: session.user.id,
      userEmail: session.user.email,
      ipAddress: clientIp(req),
    });
    return apiUnauthorized();
  }
  const userId: string = session.user.id;
  auditStore.enterWith({
    userId,
    userEmail: session.user.email ?? undefined,
    ip: clientIp(req),
  });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const schemaId = formData.get("schemaId") as string | null;
  const sheetName = (formData.get("sheetName") as string | null) ?? undefined;

  if (!file || !schemaId) return apiBadRequest("file and schemaId are required");

  // Verify access: user must belong to an org linked to a project that contains this schema
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: { select: { name: true } } },
  });

  if (!user?.organization) {
    return apiForbidden("You must belong to an organization to upload files");
  }

  const access = await prisma.schemaProject.findFirst({
    where: {
      schemaId,
      schema: { deletedAt: null },
      project: { deletedAt: null, organizations: { some: { organizationId: user.organizationId! } } },
    },
  });

  if (!access) return apiForbidden("Schema not accessible to your organization");

  const schema = await prisma.schema.findUnique({
    where: { id: schemaId },
    include: {
      columns: { orderBy: { order: "asc" } },
      projects: { include: { project: { select: { name: true } } } },
    },
  });

  if (!schema) return apiNotFound("Schema not found");

  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
  if (file.size > MAX_FILE_SIZE) return apiPayloadTooLarge("File exceeds the 100 MB size limit.");

  const ext = file.name.split(".").pop()?.toLowerCase();
  const allowedExts = ["csv", "xlsx", "xls"];
  const allowedMimes = [
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ];
  if (!allowedExts.includes(ext ?? "") && !allowedMimes.includes(file.type)) {
    return apiUnsupportedMediaType("Only CSV and Excel files (.csv, .xlsx, .xls) are allowed.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";

  // Build blob path: project/organization/schema/datetime/filename
  const sanitize = (s: string) => s.replace(/[/\\?#%]/g, "_").trim() || "_";
  const projectNames = schema.projects.map((sp) => sanitize(sp.project.name));
  const projectSegment = projectNames.length > 0 ? projectNames.join("+") : "no-project";
  const orgSegment = sanitize(user.organization.name);
  const schemaSegment = sanitize(schema.name);
  const now = new Date();
  const datetime = now.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
  const blobName = `${projectSegment}/${orgSegment}/${schemaSegment}/${datetime}/${file.name}`;

  // Upload file to blob storage
  let blobUrl: string;
  try {
    blobUrl = await uploadToBlob(buffer, blobName, mimeType);
  } catch (err: unknown) {
    console.error("Azure upload failed:", err);
    return apiServiceUnavailable("File storage is not configured. Please contact an administrator.");
  }

  // Malware scan (Defender for Storage — no-op if not configured).
  // Must block the response on both paths so a malicious file is never
  // committed to the DB or enqueued for processing.
  const scanResult = await waitForMalwareScanResult(blobName);
  if (scanResult === "malicious") {
    await deleteBlobByName(blobName);
    return apiUnprocessable("File rejected: malware detected.");
  }

  // ── Async path (Service Bus configured) ───────────────────────────────────
  // Create a PENDING record, enqueue the job, return immediately.
  // The /api/upload/process worker handles validation and row storage.
  // It is triggered by an Azure Function Service Bus trigger that
  // calls POST /api/upload/process with the message payload.
  if (isServiceBusConfigured()) {
    const record = await prisma.fileUpload.create({
      data: { userId, schemaId, schemaVersion: schema.version, fileName: file.name, blobUrl, status: "PENDING" },
    });

    await enqueueUploadJob({ uploadId: record.id, blobName, mimeType, sheetName });

    return NextResponse.json({
      uploadId: record.id,
      status: "PENDING",
      rowCount: 0,
      errorCount: 0,
      errorsCapped: false,
      errors: [],
    });
  }

  // ── Inline fallback (no Service Bus — local dev) ───────────────────────────
  // Runs the full pipeline synchronously within this request.

  // Fetch classifications in parallel with nothing else to do here
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

  const { errors, errorsCapped, rowCount, missingColumns, rows } = await validateFile(
    buffer,
    mimeType,
    columnsForValidation,
    sheetName
  );

  const missingColumnErrors = missingColumns.map((col) => ({
    row: 0,
    column: col,
    value: "",
    error: "Required column is missing from the file",
  }));

  const allErrors = [...missingColumnErrors, ...errors];
  const isValid = allErrors.length === 0;

  const record = await prisma.fileUpload.create({
    data: {
      userId,
      schemaId,
      schemaVersion: schema.version,
      fileName: file.name,
      blobUrl,
      status: isValid ? "VALID" : "INVALID",
      errorCount: allErrors.length,
      rowCount,
      errorsCapped,
    },
  });

  if (allErrors.length > 0) {
    await prisma.validationResult.createMany({
      data: allErrors.map((e) => ({ ...e, uploadId: record.id })),
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
              uploadId: record.id,
              rowIndex: startIdx + j + 1,
              data: row,
            })),
          })
        )
      );
    }
  }

  return NextResponse.json({
    uploadId: record.id,
    status: record.status,
    rowCount,
    errorCount: allErrors.length,
    errorsCapped,
    errors: allErrors,
  });
});

export const GET = withHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true, role: true },
  });

  const uploads = await prisma.fileUpload.findMany({
    where: currentUser?.organizationId
      ? { user: { organizationId: currentUser.organizationId } }
      : { userId: session.user.id },
    include: {
      schema: { select: { name: true } },
      results: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const isAdmin = currentUser?.role === "ADMIN";
  const response = isAdmin
    ? uploads
    : uploads.map(({ blobUrl: _blobUrl, ...rest }) => ({ ...rest, blobUrl: null }));

  return NextResponse.json(response);
});
