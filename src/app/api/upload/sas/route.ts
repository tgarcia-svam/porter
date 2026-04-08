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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!verifySessionBinding(session.user.uaHash, req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { schemaId, fileName, mimeType } = await req.json();

  if (!schemaId || !fileName || !mimeType) {
    return NextResponse.json({ error: "schemaId, fileName, and mimeType are required" }, { status: 400 });
  }

  const userId = session.user.id;

  // Verify access
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: { select: { name: true } } },
  });

  if (!user?.organization) {
    return NextResponse.json({ error: "You must belong to an organization to upload files" }, { status: 403 });
  }

  const access = await prisma.schemaProject.findFirst({
    where: {
      schemaId,
      project: { organizations: { some: { organizationId: user.organizationId! } } },
    },
  });

  if (!access) {
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

  const sasUrl = await generateUploadSasUrl(blobName);

  return NextResponse.json({ sasUrl, blobName });
}
