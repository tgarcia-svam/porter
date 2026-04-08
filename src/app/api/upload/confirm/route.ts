/**
 * POST /api/upload/confirm
 *
 * Called by the browser after it has successfully PUT the file directly to
 * blob storage via the SAS URL. Creates the PENDING FileUpload record and
 * enqueues the processing job.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueUploadJob } from "@/lib/service-bus";
import { verifySessionBinding } from "@/lib/session-binding";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!verifySessionBinding(session.user.uaHash, req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { blobName, schemaId, fileName, mimeType, sheetName } = await req.json();

  if (!blobName || !schemaId || !fileName || !mimeType) {
    return NextResponse.json({ error: "blobName, schemaId, fileName, and mimeType are required" }, { status: 400 });
  }

  // Reconstruct blob URL from blob name
  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL?.replace(/\/$/, "");
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "porter-uploads";
  const blobUrl = `${accountUrl}/${containerName}/${blobName}`;

  const record = await prisma.fileUpload.create({
    data: { userId, schemaId, fileName, blobUrl, status: "PENDING" },
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
