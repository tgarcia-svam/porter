import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prismaAdmin } from "@/lib/prisma-admin";
import { withOrgContext } from "@/lib/with-org-context";
import { verifySessionBinding } from "@/lib/session-binding";
import { logAuthEvent } from "@/lib/auth-audit";
import { clientIp } from "@/lib/audit-context";
import { apiUnauthorized, apiBadRequest, withHandler } from "@/lib/api-error";

/**
 * GET /api/upload/latest-data?schemaId=…&projectId=…&page=…&pageSize=…&q=…
 *
 * Returns one page of UploadRows from the most recent VALID upload for this
 * schema + project, scoped to the caller's organisation. Supports a server-side
 * search (`q`) so the user can paginate through the entire dataset, not just
 * the rows currently held client-side.
 *
 * Response shape:
 *   { rows: [{ rowIndex, data }], pagination: { page, pageSize, total, totalPages } }
 *
 * `rowIndex` is included so manual-entry edits can target specific rows in a
 * later patch submit.
 */
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
  const q = (searchParams.get("q") ?? "").trim();

  const currentUser = await prismaAdmin.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });

  if (!currentUser?.organizationId) {
    return NextResponse.json({ rows: [], pagination: { page, pageSize, total: 0, totalPages: 0 } });
  }

  const result = await withOrgContext(currentUser.organizationId, async (tx) => {
    const upload = await tx.fileUpload.findFirst({
      where: {
        schemaId,
        status: "VALID",
        deletedAt: null,
        schema: { deletedAt: null, projects: { some: { projectId } } },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!upload) return null;

    // Search: filter rows whose JSON text contains `q` (case-insensitive).
    // Raw SQL because Prisma's JSON filters don't support substring search on
    // arbitrary keys. RLS still applies inside this transaction.
    const searchFilter = q
      ? Prisma.sql`AND "data"::text ILIKE ${"%" + q + "%"}`
      : Prisma.empty;

    type Row = { rowIndex: number; data: Record<string, string> };
    const [rows, totalResult] = await Promise.all([
      tx.$queryRaw<Row[]>`
        SELECT "rowIndex", "data"
        FROM "UploadRow"
        WHERE "uploadId" = ${upload.id}
          ${searchFilter}
        ORDER BY "rowIndex" DESC
        OFFSET ${(page - 1) * pageSize}
        LIMIT ${pageSize}
      `,
      tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "UploadRow"
        WHERE "uploadId" = ${upload.id}
          ${searchFilter}
      `,
    ]);

    return { rows, total: Number(totalResult[0]?.count ?? 0) };
  }, session.user.id);

  if (!result) {
    return NextResponse.json({ rows: [], pagination: { page, pageSize, total: 0, totalPages: 0 } });
  }

  return NextResponse.json({
    rows: result.rows,
    pagination: {
      page,
      pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pageSize),
    },
  });
});
