/**
 * POST /api/upload/sas
 *
 * Returns a short-lived (15 min) write-only SAS URL so the browser can upload
 * directly to Azure Blob Storage, bypassing the app server entirely.
 *
 * The client must:
 *   1. POST here with { schemaId, fileName, mimeType, sheetName? }
 *   2. PUT the file to sasUrl with Content-Type header
 *   3. POST /api/upload/confirm with { blobName, schemaId, fileName, mimeType, sheetName? }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateUploadSasUrl } from "@/lib/azure-storage";
import { verifySessionBinding } from "@/lib/session-binding";

export async function POST(req: NextRequest) {
  console.log("[upload/sas] request received");

  const session = await auth();
  if (!session?.user?.id) {
    console.log("[upload/sas] unauthorized — no session");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!verifySessionBinding(session.user.uaHash, req)) {
    console.log("[upload/sas] unauthorized — session binding failed");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { schemaId, fileName, mimeType } = body;
  console.log("[upload/sas] body:", { schemaId, fileName, mimeType });

  if (!schemaId || !fileName || !mimeType) {
    return NextResponse.json({ error: "schemaId, fileName, and mimeType are required" }, { status: 400 });
  }

  // Log env var presence (not values) to confirm config is loaded
  console.log("[upload/sas] env check:", {
    AZURE_STORAGE_ACCOUNT_URL: !!process.env.AZURE_STORAGE_ACCOUNT_URL,
    AZURE_STORAGE_ACCOUNT_NAME: !!process.env.AZURE_STORAGE_ACCOUNT_NAME,
    AZURE_STORAGE_ACCOUNT_KEY: !!process.env.AZURE_STORAGE_ACCOUNT_KEY,
    AZURE_DIRECT_UPLOAD_ENABLED: process.env.AZURE_DIRECT_UPLOAD_ENABLED,
  });

  const userId = session.user.id;

  // Verify access
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: { select: { name: true } } },
  });

  if (!user?.organization) {
    console.log("[upload/sas] no organization for user", userId);
    return NextResponse.json({ error: "You must belong to an organization to upload files" }, { status: 403 });
  }

  const access = await prisma.schemaProject.findFirst({
    where: {
      schemaId,
      project: { organizations: { some: { organizationId: user.organizationId! } } },
    },
  });

  if (!access) {
    console.log("[upload/sas] schema not accessible:", schemaId);
    return NextResponse.json({ error: "Schema not accessible to your organization" }, { status: 403 });
  }

  const schema = await prisma.schema.findUnique({
    where: { id: schemaId },
    include: { projects: { include: { project: { select: { name: true } } } } },
  });

  if (!schema) return NextResponse.json({ error: "Schema not found" }, { status: 404 });

  // Build blob path
  const sanitize = (s: string) => s.replace(/[/\\?#%]/g, "_").trim() || "_";
  const projectNames = schema.projects.map((sp) => sanitize(sp.project.name));
  const projectSegment = projectNames.length > 0 ? projectNames.join("+") : "no-project";
  const orgSegment = sanitize(user.organization.name);
  const schemaSegment = sanitize(schema.name);
  const datetime = new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "");
  const blobName = `${projectSegment}/${orgSegment}/${schemaSegment}/${datetime}/${fileName}`;
  console.log("[upload/sas] generating SAS for blob:", blobName);

  let sasUrl: string;
  try {
    sasUrl = await generateUploadSasUrl(blobName);
    console.log("[upload/sas] SAS URL generated successfully");
  } catch (err) {
    console.error("[upload/sas] generateUploadSasUrl failed:", err);
    return NextResponse.json(
      { error: `Could not generate upload URL: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ sasUrl, blobName });
}
