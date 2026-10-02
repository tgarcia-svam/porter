import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prismaAdmin } from "@/lib/prisma-admin";
import { withOrgContext } from "@/lib/with-org-context";
import { apiUnauthorized, apiForbidden, apiNotFound, apiBadRequest, withHandler } from "@/lib/api-error";

const ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export const GET = withHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();

  const id = req.nextUrl.searchParams.get("uploadId") ?? "";
  if (!id || !ID_RE.test(id)) return apiBadRequest("uploadId required");

  const currentUser = await prismaAdmin.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });

  if (!currentUser?.organizationId) return apiNotFound();

  const upload = await withOrgContext(currentUser.organizationId, async (tx) => {
    return tx.fileUpload.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        userId: true,
        status: true,
        errorCount: true,
        rowCount: true,
        errorsCapped: true,
        results: {
          select: { row: true, column: true, value: true, error: true },
          orderBy: { row: "asc" },
          take: 100,
        },
      },
    });
  }, session.user.id);

  if (!upload) return apiNotFound();

  if (upload.userId !== session.user.id) return apiForbidden();

  return NextResponse.json({
    uploadId: upload.id,
    status: upload.status,
    rowCount: upload.rowCount,
    errorCount: upload.errorCount,
    errorsCapped: upload.errorsCapped,
    errors: upload.status === "PENDING" ? [] : upload.results,
  });
});
