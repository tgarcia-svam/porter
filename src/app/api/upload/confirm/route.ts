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
  console.log("[upload/confirm] request received");

  const session = await auth();
  if (!session?.user?.id) {
    console.log("[upload/confirm] unauthorized — no session");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!verifySessionBinding(session.user.uaHash, req)) {
    console.log("[upload/confirm] unauthorized — session binding failed");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const body = await req.json();
  const { blobName, schemaId, fileName, mimeType, sheetName } = body;
  console.log("[upload/confirm] body:", { blobName, schemaId, fileName, mimeType, sheetName });

  if (!blobName || !schemaId || !fileName || !mimeType) {
    return NextResponse.json({ error: "blobName, schemaId, fileName, and mimeType are required" }, { status: 400 });
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

  console.log("[upload/confirm] creating DB record...");
  let record: { id: string };
  try {
    record = await prisma.fileUpload.create({
      data: { userId, schemaId, fileName, blobUrl, status: "PENDING" },
    });
    console.log("[upload/confirm] DB record created:", record.id);
  } catch (err) {
    console.error("[upload/confirm] DB create failed:", err);
    return NextResponse.json({ error: "Failed to create upload record." }, { status: 500 });
  }

  console.log("[upload/confirm] enqueueing job...");
  try {
    await enqueueUploadJob({ uploadId: record.id, blobName, mimeType, sheetName });
    console.log("[upload/confirm] job enqueued successfully");
  } catch (err) {
    console.error("[upload/confirm] enqueueUploadJob failed:", err);
    return NextResponse.json({ error: `Failed to queue processing job: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }

  return NextResponse.json({
    uploadId: record.id,
    status: "PENDING",
    rowCount: 0,
    errorCount: 0,
    errorsCapped: false,
    errors: [],
  });
}
