import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prismaAdmin } from "@/lib/prisma-admin";
import { withOrgContext } from "@/lib/with-org-context";
import { verifySessionBinding } from "@/lib/session-binding";
import { logAuthEvent } from "@/lib/auth-audit";
import { clientIp } from "@/lib/audit-context";
import { apiUnauthorized, apiBadRequest, apiNotFound, withHandler } from "@/lib/api-error";

const TRUNC: Record<string, string> = { DAY: "day", MONTH: "month", YEAR: "year" };
const FMT: Record<string, string> = { DAY: "YYYY-MM-DD", MONTH: "YYYY-MM", YEAR: "YYYY" };

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
    return NextResponse.json({ totalCount: 0, timeSeries: [] });
  }

  // Schema metadata is admin-owned — bypass RLS to read timeSeries config.
  const schema = await prismaAdmin.schema.findUnique({
    where: { id: schemaId },
    select: { timeSeriesColumn: true, timeSeriesGranularity: true },
  });
  if (!schema) return apiNotFound("Schema not found");

  // All upload-data reads enforce org isolation via RLS.
  const result = await withOrgContext(currentUser.organizationId, async (tx) => {
    const upload = await tx.fileUpload.findFirst({
      where: {
        schemaId,
        status: "VALID",
        schema: { projects: { some: { projectId } } },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (!upload) return null;

    const totalCount = await tx.uploadRow.count({ where: { uploadId: upload.id } });

    if (!schema.timeSeriesColumn || !schema.timeSeriesGranularity) {
      return { totalCount, timeSeries: [] };
    }

    const col = schema.timeSeriesColumn;
    const trunc = TRUNC[schema.timeSeriesGranularity];
    const fmt = FMT[schema.timeSeriesGranularity];

    type Row = { label: string; count: bigint };
    const rows = await tx.$queryRaw<Row[]>`
      SELECT
        TO_CHAR(DATE_TRUNC(${trunc}, (data->>${col})::date), ${fmt}) AS label,
        COUNT(*)                                                       AS count
      FROM "UploadRow"
      WHERE "uploadId" = ${upload.id}
        AND data->>${col} IS NOT NULL
        AND data->>${col} <> ''
        AND (data->>${col})::date IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `;

    return {
      totalCount,
      granularity: schema.timeSeriesGranularity,
      timeSeries: rows.map((r) => ({ label: r.label, count: Number(r.count) })),
    };
  }, session.user.id);

  if (!result) return NextResponse.json({ totalCount: 0, timeSeries: [] });
  return NextResponse.json(result);
});
