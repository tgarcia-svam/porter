import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });

  if (!currentUser?.organizationId) {
    return NextResponse.json({ rows: [], pagination: { page, pageSize, total: 0, totalPages: 0 } });
  }

  // Find the latest valid upload for this schema + project + org
  const upload = await prisma.fileUpload.findFirst({
    where: {
      schemaId,
      status: "VALID",
      user: { organizationId: currentUser.organizationId },
      schema: { deletedAt: null, projects: { some: { projectId } } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!upload) {
    return NextResponse.json({ rows: [], pagination: { page, pageSize, total: 0, totalPages: 0 } });
  }

  // Fetch page + total in parallel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uploadRowModel = (prisma as any).uploadRow;
  const [uploadRows, total] = await Promise.all([
    uploadRowModel.findMany({
      where: { uploadId: upload.id },
      orderBy: { rowIndex: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    uploadRowModel.count({ where: { uploadId: upload.id } }),
  ]);

  return NextResponse.json({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: uploadRows.map((r: any) => r.data),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
});
