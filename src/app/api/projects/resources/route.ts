import { NextRequest, NextResponse } from "next/server";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { auth } from "@/lib/auth";
import {
  apiForbidden,
  apiUnauthorized,
  apiNotFound,
  apiBadRequest,
  withHandler,
} from "@/lib/api-error";

const ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

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

export const GET = withHandler(async (req: NextRequest) => {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? "";
  if (!projectId || !ID_RE.test(projectId)) return apiBadRequest("projectId required");

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
