import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { prismaAdmin } from "@/lib/prisma-admin";
import { computeVisualizations } from "@/lib/visualization-aggregate";
import { apiUnauthorized, apiBadRequest, apiNotFound, withHandler } from "@/lib/api-error";

/**
 * Admin analytics: pre-configured reports for a (project, file format) pair,
 * pooling the data of one or more providers (organizations). Reads cross-org
 * data, so it must use `prismaAdmin` (RLS bypass) — hence the admin guard.
 *
 * Response:
 *   { configured: boolean, hasData: boolean, visualizations: [...] }
 *   - configured=false → the schema has no visualizations defined.
 *   - hasData=false     → no VALID upload exists for the selected providers.
 */
export const GET = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiUnauthorized();

  const { searchParams } = req.nextUrl;
  const projectId = searchParams.get("projectId");
  const schemaId = searchParams.get("schemaId");
  if (!projectId || !schemaId) return apiBadRequest("projectId and schemaId are required");

  // The file format must be assigned to the project.
  const link = await prismaAdmin.schemaProject.findUnique({
    where: { schemaId_projectId: { schemaId, projectId } },
    select: { schemaId: true },
  });
  if (!link) return apiBadRequest("Schema is not assigned to this project");

  // Candidate providers = organizations assigned to the project (non-deleted).
  const projectOrgs = await prismaAdmin.projectOrganization.findMany({
    where: { projectId, organization: { deletedAt: null } },
    select: { organizationId: true },
  });
  const allowedOrgIds = new Set(projectOrgs.map((o) => o.organizationId));

  // The client always sends its current selection; keep only orgs that are
  // actually on the project (ignore stale/unknown ids). An empty selection
  // means "no providers" → no data.
  const selectedOrgIds = searchParams
    .getAll("orgId")
    .filter((id) => allowedOrgIds.has(id));

  // Visualization config for the schema.
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
    return NextResponse.json({ configured: false, hasData: false, visualizations: [] });
  }
  if (selectedOrgIds.length === 0) {
    return NextResponse.json({ configured: true, hasData: false, visualizations: [] });
  }

  // Latest VALID upload per selected provider for this (schema, project).
  // Run all org lookups in parallel — one round-trip per org is still N queries
  // but they execute concurrently rather than serially.
  const uploadResults = await Promise.all(
    selectedOrgIds.map((organizationId) =>
      prismaAdmin.fileUpload.findFirst({
        where: {
          schemaId,
          status: "VALID",
          deletedAt: null,
          schema: { projects: { some: { projectId } } },
          user: { organizationId },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    )
  );
  const uploadIds = uploadResults.filter(Boolean).map((u) => u!.id);

  if (uploadIds.length === 0) {
    return NextResponse.json({ configured: true, hasData: false, visualizations: [] });
  }

  const visualizations = await computeVisualizations(prismaAdmin, uploadIds, schema.visualizations);
  return NextResponse.json({ configured: true, hasData: true, visualizations });
});
