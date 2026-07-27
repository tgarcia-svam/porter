import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { withOrgContext } from "@/lib/with-org-context";
import { validateFile } from "@/lib/validate";
import { uploadToBlob, waitForMalwareScanResult, deleteBlobByName, isMalwareScanFailClosed } from "@/lib/azure-storage";
import { exportUploadToWarehouse } from "@/lib/warehouse-export";
import { enqueueUploadJob, isServiceBusConfigured } from "@/lib/service-bus";
import {
  resolveValidationColumns,
  resolveSchemaComparisons,
  buildUploadBlobName,
  toMissingColumnErrors,
  createUploadWithResults,
} from "@/lib/upload-service";
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
  const projectId = (formData.get("projectId") as string | null) || null;
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

  // When a project is specified it must contain this schema AND be assigned to
  // the user's org; otherwise any project of the org that contains the schema.
  const access = await prisma.schemaProject.findFirst({
    where: {
      schemaId,
      ...(projectId ? { projectId } : {}),
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

  const { blobName } = buildUploadBlobName({
    projectNames: schema.projects.map((sp) => sp.project.name),
    orgName: user.organization.name,
    schemaName: schema.name,
    fileName: file.name,
  });

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
  // Fail-closed: if the scan hasn't completed in time, don't let an unscanned
  // file through. Drop the blob and ask the user to retry.
  if (scanResult === "pending" && isMalwareScanFailClosed()) {
    await deleteBlobByName(blobName);
    return apiServiceUnavailable("File could not be virus-scanned in time. Please try again.");
  }

  // ── Async path (Service Bus configured) ───────────────────────────────────
  // Create a PENDING record, enqueue the job, return immediately.
  // The /api/upload/process worker handles validation and row storage.
  // It is triggered by an Azure Function Service Bus trigger that
  // calls POST /api/upload/process with the message payload.
  if (isServiceBusConfigured()) {
    const record = await prisma.fileUpload.create({
      data: { userId, schemaId, projectId, schemaVersion: schema.version, fileName: file.name, blobUrl, status: "PENDING" },
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

  const [columnsForValidation, comparisons] = await Promise.all([
    resolveValidationColumns(schema.columns),
    resolveSchemaComparisons(schemaId),
  ]);

  const { errors, errorsCapped, rowCount, missingColumns, rows } = await validateFile(
    buffer,
    mimeType,
    columnsForValidation,
    sheetName,
    file.name,
    comparisons,
  );

  const allErrors = [...toMissingColumnErrors(missingColumns), ...errors];

  const record = await createUploadWithResults({
    userId,
    schemaId,
    projectId,
    schemaVersion: schema.version,
    fileName: file.name,
    blobUrl,
    rowCount,
    errorsCapped,
    errors: allErrors,
    rows,
  });

  // Best-effort warehouse export (inline fallback path only — never throws).
  if (record.status === "VALID") {
    await exportUploadToWarehouse(record.id);
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

  // prismaAdmin for the user lookup — User is admin-owned config, not user-data.
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true, role: true },
  });

  const isAdmin = currentUser?.role === "ADMIN";

  // withOrgContext so the RLS policy filters FileUpload to this org only,
  // providing a database-level safety net on top of the app-layer org filter.
  // Fall back to userId-scoped admin query for orphan accounts (dev only).
  const uploads = currentUser?.organizationId
    ? await withOrgContext(currentUser.organizationId, (tx) =>
        tx.fileUpload.findMany({
          where: { deletedAt: null },
          include: {
            schema: { select: { name: true } },
            results: true,
            user: { select: { name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        session.user.id
      )
    : await prisma.fileUpload.findMany({
        where: { deletedAt: null, userId: session.user.id },
        include: {
          schema: { select: { name: true } },
          results: true,
          user: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

  const response = isAdmin
    ? uploads
    : uploads.map(({ blobUrl: _blobUrl, ...rest }) => ({ ...rest, blobUrl: null }));

  return NextResponse.json(response);
});
