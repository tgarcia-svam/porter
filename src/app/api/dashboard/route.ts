import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prismaAdmin } from "@/lib/prisma-admin";
import { withOrgContext } from "@/lib/with-org-context";
import { verifySessionBinding } from "@/lib/session-binding";
import { logAuthEvent } from "@/lib/auth-audit";
import { clientIp } from "@/lib/audit-context";
import { apiUnauthorized, apiBadRequest, apiNotFound, withHandler } from "@/lib/api-error";
import { computeVisualizations } from "@/lib/visualization-aggregate";

export const GET = withHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();

  if (!verifySessionBinding(session.user.uaHash, req)) {
    logAuthEvent({
      action: "auth.session.invalid",
      userId: session.user.id,
      userEmail: session.user.email,
      ipAddress: clientIp(req),
    });
    return apiUnauthorized();
  }

  const { searchParams } = req.nextUrl;
  const schemaId = searchParams.get("schemaId");
  const projectId = searchParams.get("projectId");
  if (!schemaId || !projectId) return apiBadRequest("schemaId and projectId are required");

  // User → org lookup happens outside RLS (no context yet).
  const currentUser = await prismaAdmin.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });
  if (!currentUser?.organizationId) {
    return NextResponse.json({ hasData: false, visualizations: [] });
  }

  // Visualization config is admin-owned — bypass RLS to read it.
  const schema = await prismaAdmin.schema.findUnique({
    where: { id: schemaId },
    select: {
      visualizations: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          type: true,
          title: true,
          aggregate: true,
          valueColumn: true,
          xColumn: true,
          granularity: true,
        },
      },
    },
  });
  if (!schema) return apiNotFound("Schema not found");

  if (schema.visualizations.length === 0) {
    return NextResponse.json({ hasData: false, visualizations: [] });
  }

  // All upload-data reads enforce org isolation via RLS.
  const result = await withOrgContext(
    currentUser.organizationId,
    async (tx) => {
      const upload = await tx.fileUpload.findFirst({
        where: {
          schemaId,
          status: "VALID",
          deletedAt: null,
          schema: { projects: { some: { projectId } } },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!upload) return null;

      return computeVisualizations(tx, [upload.id], schema.visualizations);
    },
    session.user.id
  );

  if (!result) return NextResponse.json({ hasData: false, visualizations: [] });
  return NextResponse.json({ hasData: true, visualizations: result });
});
