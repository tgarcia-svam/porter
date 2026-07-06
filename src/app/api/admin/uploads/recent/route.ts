import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { prismaAdmin } from "@/lib/prisma-admin";
import { apiUnauthorized, withHandler } from "@/lib/api-error";

/**
 * GET /api/admin/uploads/recent?page=&pageSize=
 *
 * Admin cross-org listing of the most recent uploads, newest first, paginated.
 * Response: { rows, pagination: { page, pageSize, total, totalPages } }.
 */
export const GET = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiUnauthorized();

  const { searchParams } = req.nextUrl;
  const PAGE_SIZE_DEFAULT = 20;
  const PAGE_SIZE_MAX = 100;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT)
  );

  const [uploads, total] = await Promise.all([
    prismaAdmin.fileUpload.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        fileName: true,
        status: true,
        createdAt: true,
        schema: { select: { name: true } },
        project: { select: { name: true } },
        user: {
          select: { name: true, email: true, organization: { select: { name: true } } },
        },
      },
    }),
    prismaAdmin.fileUpload.count({ where: { deletedAt: null } }),
  ]);

  const rows = uploads.map((u) => ({
    id: u.id,
    project: u.project?.name ?? null,
    fileFormat: u.schema.name,
    fileName: u.fileName,
    date: u.createdAt.toISOString(),
    status: u.status,
    user: u.user.name ?? u.user.email,
    organization: u.user.organization?.name ?? null,
  }));

  return NextResponse.json({
    rows,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
});
