/**
 * POST /api/upload/confirm
 *
 * Called by the browser after it has successfully PUT the file directly to
 * blob storage via the SAS URL. Creates the PENDING FileUpload record and
 * enqueues the processing job.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
// TODO(RLS): refactor to withOrgContext once the upload pipeline is split.
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { enqueueUploadJob } from "@/lib/service-bus";
import { verifySessionBinding } from "@/lib/session-binding";
import { apiUnauthorized, apiForbidden, apiBadRequest, apiNotFound, apiInternalError, withHandler } from "@/lib/api-error";

export const POST = withHandler(async (req: NextRequest) => {
  console.log("[upload/confirm] request received");

  const session = await auth();
  if (!session?.user?.id) {
    console.log("[upload/confirm] unauthorized — no session");
    return apiUnauthorized();
  }

  if (!verifySessionBinding(session.user.uaHash, req)) {
    console.log("[upload/confirm] unauthorized — session binding failed");
    return apiUnauthorized();
  }

  const userId = session.user.id;
  const body = await req.json();
  const { blobName, schemaId, fileName, mimeType, sheetName } = body;
  const projectId: string | null = body.projectId || null;
  console.log("[upload/confirm] body:", { schemaId, mimeType, sheetName });

  if (!blobName || !schemaId || !fileName || !mimeType) {
    return apiBadRequest("blobName, schemaId, fileName, and mimeType are required");
  }

  // If a project is specified it must contain this schema and be assigned to the
  // user's org — mirrors the /api/upload/sas access check.
  if (projectId) {
    const access = await prisma.schemaProject.findFirst({
      where: {
        schemaId,
        projectId,
        schema: { deletedAt: null },
        project: {
          deletedAt: null,
          organizations: { some: { organization: { users: { some: { id: userId } } } } },
        },
      },
      select: { schemaId: true },
    });
    if (!access) return apiForbidden("Project not accessible for this upload");
  }

  // Log env var presence
  console.log("[upload/confirm] env check:", {
    AZURE_SERVICE_BUS_CONNECTION_STRING: !!process.env.AZURE_SERVICE_BUS_CONNECTION_STRING,
    AZURE_SERVICE_BUS_NAMESPACE: !!process.env.AZURE_SERVICE_BUS_NAMESPACE,
    AZURE_SERVICE_BUS_QUEUE_NAME: process.env.AZURE_SERVICE_BUS_QUEUE_NAME,
  });

  // Reconstruct blob URL from blob name
  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL?.replace(/\/$/, "");
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "porter-uploads";
  const blobUrl = `${accountUrl}/${containerName}/${blobName}`;

  // Capture schema version at upload time so the record can always be
  // interpreted against the exact column definitions that were in effect.
  const schema = await prisma.schema.findUnique({ where: { id: schemaId }, select: { version: true } });
  if (!schema) return apiNotFound("Schema not found");

  console.log("[upload/confirm] creating DB record...");
  let record: { id: string };
  try {
    record = await prisma.fileUpload.create({
      data: { userId, schemaId, projectId, schemaVersion: schema.version, fileName, blobUrl, status: "PENDING" },
    });
    console.log("[upload/confirm] DB record created:", record.id);
  } catch (err) {
    console.error("[upload/confirm] DB create failed:", err);
    return apiInternalError("Failed to create upload record.");
  }

  console.log("[upload/confirm] enqueueing job...");
  try {
    await enqueueUploadJob({ uploadId: record.id, blobName, mimeType, sheetName });
    console.log("[upload/confirm] job enqueued successfully");
  } catch (err) {
    console.error("[upload/confirm] enqueueUploadJob failed:", err);
    return apiInternalError(
      `Failed to queue processing job: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return NextResponse.json({
    uploadId: record.id,
    status: "PENDING",
    rowCount: 0,
    errorCount: 0,
    errorsCapped: false,
    errors: [],
  });
});
