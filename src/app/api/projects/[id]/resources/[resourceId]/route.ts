import { NextRequest, NextResponse } from "next/server";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiNotFound, withHandler } from "@/lib/api-error";
import { deleteBlobByName } from "@/lib/azure-storage";

type RouteContext = { params: Promise<{ id: string; resourceId: string }> };

export const DELETE = withHandler<RouteContext>(async (req, { params }) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const { id: projectId, resourceId } = await params;

  const resource = await prisma.projectResource.findFirst({
    where: { id: resourceId, projectId, deletedAt: null },
  });
  if (!resource) return apiNotFound("Resource not found");

  await prisma.projectResource.update({
    where: { id: resourceId },
    data: { deletedAt: new Date() },
  });

  try {
    await deleteBlobByName(resource.blobName);
  } catch (err) {
    console.error("[resources] blob delete failed (non-fatal):", err);
  }

  return new NextResponse(null, { status: 204 });
});
