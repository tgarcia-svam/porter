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
import { z } from "zod";
import { auth } from "@/lib/auth";
// TODO(RLS): refactor to withOrgContext once the upload pipeline is split.
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { generateUploadSasUrl } from "@/lib/azure-storage";
import { verifySessionBinding } from "@/lib/session-binding";
import { apiUnauthorized, apiForbidden, apiBadRequest, apiNotFound, apiInternalError, withHandler } from "@/lib/api-error";

const SasBody = z.object({
  schemaId:  z.string().min(1),
  // Restrict to characters safe in blob paths and URLs; max 255 chars.
  fileName:  z.string().min(1).max(255).regex(/^[^/\\<>:"|?*\x00-\x1f]+$/),
  mimeType:  z.string().min(1),
  projectId: z.string().optional().nullable(),
});

export const POST = withHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();

  if (!verifySessionBinding(session.user.uaHash, req)) return apiUnauthorized();

  const parsed = SasBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const { schemaId, fileName, mimeType, projectId = null } = parsed.data;
  const userId = session.user.id;

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
    include: { projects: { include: { project: { select: { name: true } } } } },
  });

  if (!schema) return apiNotFound("Schema not found");

  // Build blob path. Apply the same sanitizer to all segments including fileName
  // so no segment can inject path separators or URL-special characters.
  const sanitize = (s: string) => s.replace(/[/\\?#%]/g, "_").trim() || "_";
  const projectNames = schema.projects
    .filter((sp) => !projectId || sp.projectId === projectId)
    .map((sp) => sanitize(sp.project.name));
  const projectSegment = projectNames.length > 0 ? projectNames.join("+") : "no-project";
  const orgSegment    = sanitize(user.organization.name);
  const schemaSegment = sanitize(schema.name);
  const datetime      = new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "");
  const blobName      = `${projectSegment}/${orgSegment}/${schemaSegment}/${datetime}/${sanitize(fileName)}`;

  let sasUrl: string;
  try {
    sasUrl = await generateUploadSasUrl(blobName);
  } catch (err) {
    console.error("[upload/sas] failed to generate SAS URL:", err);
    return apiInternalError("Could not generate upload URL. Please try again or contact an administrator.");
  }

  return NextResponse.json({ sasUrl, blobName });
});
