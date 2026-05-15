import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prismaAdmin } from "@/lib/prisma-admin";
import { withOrgContext } from "@/lib/with-org-context";
import { verifySessionBinding } from "@/lib/session-binding";
import { logAuthEvent } from "@/lib/auth-audit";
import { clientIp } from "@/lib/audit-context";
import { apiUnauthorized, apiBadRequest, withHandler } from "@/lib/api-error";

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

  const PAGE_SIZE_DEFAULT = 100;
  const PAGE_SIZE_MAX = 1000;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT)
  );

  // Look up the user's org without RLS — there's no context yet to set.
  const currentUser = await prismaAdmin.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });

  if (!currentUser?.organizationId) {
    return NextResponse.json({ rows: [], pagination: { page, pageSize, total: 0, totalPages: 0 } });
  }

  // Subsequent queries are scoped to the user's org by RLS.
  const result = await withOrgContext(currentUser.organizationId, async (tx) => {
    const upload = await tx.fileUpload.findFirst({
      where: {
        schemaId,
        status: "VALID",
        deletedAt: null,
        schema: { deletedAt: null, projects: { some: { projectId } } },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!upload) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uploadRowModel = (tx as any).uploadRow;
    const [uploadRows, total] = await Promise.all([
      uploadRowModel.findMany({
        where: { uploadId: upload.id },
        orderBy: { rowIndex: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      uploadRowModel.count({ where: { uploadId: upload.id } }),
    ]);
    return { uploadRows, total };
  }, session.user.id);

  if (!result) {
    return NextResponse.json({ rows: [], pagination: { page, pageSize, total: 0, totalPages: 0 } });
  }

  return NextResponse.json({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: result.uploadRows.map((r: any) => r.data),
    pagination: {
      page,
      pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pageSize),
    },
  });
});
