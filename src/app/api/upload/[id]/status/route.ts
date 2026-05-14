/**
 * GET /api/upload/[id]/status
 *
 * Polling endpoint used by the uploader UI to check whether a PENDING upload
 * has finished processing. Returns the current status and, once complete, the
 * full validation results (errors, rowCount, errorsCapped).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prismaAdmin } from "@/lib/prisma-admin";
import { withOrgContext } from "@/lib/with-org-context";
import { apiUnauthorized, apiForbidden, apiNotFound, withHandler } from "@/lib/api-error";

export const GET = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const { id } = await params;

    const currentUser = await prismaAdmin.user.findUnique({
      where: { id: session.user.id },
      select: { organizationId: true },
    });

    if (!currentUser?.organizationId) return apiNotFound();

    // RLS hides cross-org rows; soft-deleted uploads are also hidden.
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

    // Users may only poll their own uploads (within their org).
    if (upload.userId !== session.user.id) return apiForbidden();

    return NextResponse.json({
      uploadId: upload.id,
      status: upload.status,
      rowCount: upload.rowCount,
      errorCount: upload.errorCount,
      errorsCapped: upload.errorsCapped,
      errors: upload.status === "PENDING" ? [] : upload.results,
    });
  }
);
