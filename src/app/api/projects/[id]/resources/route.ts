import { NextRequest, NextResponse } from "next/server";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/api-auth";
import {
  apiForbidden,
  apiUnauthorized,
  apiNotFound,
  apiBadRequest,
  apiInternalError,
  withHandler,
} from "@/lib/api-error";
import { uploadToBlob } from "@/lib/azure-storage";

type RouteContext = { params: Promise<{ id: string }> };

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\?#%<>:|"*]/g, "_").trim() || "file";
}

function normalizePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Strip leading/trailing slashes and collapse doubles
  const cleaned = raw.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "").trim();
  return cleaned || null;
}

function serializeResource(r: {
  id: string;
  fileName: string;
  filePath: string | null;
  contentType: string | null;
  organizationIds: string[];
  createdAt: Date;
}) {
  return {
    id: r.id,
    fileName: r.fileName,
    filePath: r.filePath,
    contentType: r.contentType,
    organizationIds: r.organizationIds,
    createdAt: r.createdAt.toISOString(),
  };
}

export const GET = withHandler<RouteContext>(async (req, { params }) => {
  const { id: projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();

  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
  });
  if (!project) return apiNotFound("Project not found");

  const isAdmin = session.user.role === "ADMIN";

  let resources;
  if (isAdmin) {
    resources = await prisma.projectResource.findMany({
      where: { projectId, deletedAt: null },
      orderBy: [{ filePath: "asc" }, { fileName: "asc" }],
    });
  } else {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { organizationId: true },
    });
    if (!user?.organizationId) {
      return apiForbidden("You must belong to an organization");
    }

    const access = await prisma.projectOrganization.findFirst({
      where: { projectId, organizationId: user.organizationId },
    });
    if (!access) return apiForbidden("Project not accessible to your organization");

    resources = await prisma.projectResource.findMany({
      where: {
        projectId,
        deletedAt: null,
        OR: [
          { organizationIds: { isEmpty: true } },
          { organizationIds: { has: user.organizationId } },
        ],
      },
      orderBy: [{ filePath: "asc" }, { fileName: "asc" }],
    });
  }

  return NextResponse.json(resources.map(serializeResource));
});

export const POST = withHandler<RouteContext>(async (req, { params }) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const { id: projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
  });
  if (!project) return apiNotFound("Project not found");

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiBadRequest("Expected multipart/form-data");
  }

  const file = formData.get("file") as File | null;
  const organizationIdsRaw = formData.get("organizationIds") as string | null;
  const filePathRaw = formData.get("filePath") as string | null;

  if (!file || file.size === 0) return apiBadRequest("file is required");

  let organizationIds: string[] = [];
  if (organizationIdsRaw) {
    try {
      const parsed = JSON.parse(organizationIdsRaw);
      if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string")) {
        return apiBadRequest("organizationIds must be an array of strings");
      }
      organizationIds = parsed;
    } catch {
      return apiBadRequest("organizationIds must be valid JSON");
    }
  }

  if (organizationIds.length > 0) {
    const assignments = await prisma.projectOrganization.findMany({
      where: { projectId, organizationId: { in: organizationIds } },
      select: { organizationId: true },
    });
    const assignedIds = new Set(assignments.map((a) => a.organizationId));
    const missing = organizationIds.filter((id) => !assignedIds.has(id));
    if (missing.length > 0) {
      return apiBadRequest("Some organizations are not assigned to this project");
    }
  }

  const filePath = normalizePath(filePathRaw);
  const safeFileName = sanitizeFileName(file.name);
  const blobName = `resources/${projectId}/${crypto.randomUUID()}/${safeFileName}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";

  try {
    await uploadToBlob(buffer, blobName, contentType);
  } catch (err) {
    console.error("[resources] blob upload failed:", err);
    return apiInternalError("File upload failed. Please try again.");
  }

  const resource = await prisma.projectResource.create({
    data: {
      projectId,
      organizationIds,
      filePath,
      fileName: file.name,
      blobName,
      contentType,
      uploadedByUserId: session.user.id,
    },
  });

  return NextResponse.json(serializeResource(resource), { status: 201 });
});
