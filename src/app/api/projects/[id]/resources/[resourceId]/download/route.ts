import { NextRequest, NextResponse } from "next/server";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { auth } from "@/lib/auth";
import { apiForbidden, apiUnauthorized, apiNotFound, apiInternalError, withHandler } from "@/lib/api-error";
import { generateDownloadSasUrl } from "@/lib/azure-storage";

type RouteContext = { params: Promise<{ id: string; resourceId: string }> };

export const GET = withHandler<RouteContext>(async (req, { params }) => {
  const { id: projectId, resourceId } = await params;
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();

  const resource = await prisma.projectResource.findFirst({
    where: { id: resourceId, projectId, deletedAt: null },
  });
  if (!resource) return apiNotFound("Resource not found");

  if (session.user.role !== "ADMIN") {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { organizationId: true },
    });
    if (!user?.organizationId) return apiForbidden("You must belong to an organization");

    // Non-empty array = restricted to specific orgs
    if (
      resource.organizationIds.length > 0 &&
      !resource.organizationIds.includes(user.organizationId)
    ) {
      return apiForbidden("Resource not accessible to your organization");
    }

    const access = await prisma.projectOrganization.findFirst({
      where: { projectId, organizationId: user.organizationId },
    });
    if (!access) return apiForbidden("Project not accessible to your organization");
  }

  const disposition = new URL(req.url).searchParams.get("disposition") ?? "inline";
  const contentDisposition =
    disposition === "attachment"
      ? `attachment; filename="${resource.fileName.replace(/"/g, '\\"')}"`
      : undefined;

  let downloadUrl: string;
  try {
    downloadUrl = await generateDownloadSasUrl(resource.blobName, contentDisposition);
  } catch (err) {
    console.error("[resources/download] SAS generation failed:", err);
    return apiInternalError("Could not generate download URL. Please try again.");
  }

  return NextResponse.json({ downloadUrl, fileName: resource.fileName });
});
