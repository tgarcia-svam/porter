/**
 * POST /api/upload/confirm
 *
 * Called by the browser after it has successfully PUT the file directly to
 * blob storage via the SAS URL. Creates the PENDING FileUpload record and
 * enqueues the processing job.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { enqueueUploadJob } from "@/lib/service-bus";
import { verifySessionBinding } from "@/lib/session-binding";
import { apiUnauthorized, apiForbidden, apiBadRequest, apiNotFound, apiInternalError, withHandler } from "@/lib/api-error";

const ConfirmBody = z.object({
  blobName:  z.string().min(1),
  schemaId:  z.string().min(1),
  fileName:  z.string().min(1).max(255),
  mimeType:  z.string().min(1),
  projectId: z.string().optional().nullable(),
  sheetName: z.string().optional(),
});

export const POST = withHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();

  if (!verifySessionBinding(session.user.uaHash, req)) return apiUnauthorized();

  const parsed = ConfirmBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const { blobName, schemaId, fileName, mimeType, projectId = null, sheetName } = parsed.data;
  const userId = session.user.id;

  // Always verify the user's org has access to this schema (and optionally the
  // specific project). This mirrors the SAS-route check and closes the gap where
  // a crafted confirm request could create a FileUpload for an inaccessible schema.
  const access = await prisma.schemaProject.findFirst({
    where: {
      schemaId,
      ...(projectId ? { projectId } : {}),
      schema: { deletedAt: null },
      project: {
        deletedAt: null,
        organizations: { some: { organization: { users: { some: { id: userId } } } } },
      },
    },
    select: { schemaId: true },
  });
  if (!access) return apiForbidden("Schema not accessible for this upload");

  const schema = await prisma.schema.findUnique({ where: { id: schemaId }, select: { version: true } });
  if (!schema) return apiNotFound("Schema not found");

  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL?.replace(/\/$/, "");
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "porter-uploads";
  const blobUrl = `${accountUrl}/${containerName}/${blobName}`;

  let record: { id: string };
  try {
    record = await prisma.fileUpload.create({
      data: { userId, schemaId, projectId, schemaVersion: schema.version, fileName, blobUrl, status: "PENDING" },
    });
  } catch (err) {
    console.error("[upload/confirm] DB create failed:", err);
    return apiInternalError("Failed to create upload record.");
  }

  try {
    await enqueueUploadJob({ uploadId: record.id, blobName, mimeType, sheetName });
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
