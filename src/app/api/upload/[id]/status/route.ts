/**
 * GET /api/upload/[id]/status
 *
 * Polling endpoint used by the uploader UI to check whether a PENDING upload
 * has finished processing. Returns the current status and, once complete, the
 * full validation results (errors, rowCount, errorsCapped).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const upload = await prisma.fileUpload.findUnique({
    where: { id },
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
        take: 100, // matches MAX_ERRORS cap in validate.ts
      },
    },
  });

  if (!upload) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Users may only poll their own uploads
  if (upload.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    uploadId: upload.id,
    status: upload.status,
    rowCount: upload.rowCount,
    errorCount: upload.errorCount,
    errorsCapped: upload.errorsCapped,
    // Only include errors when processing is complete
    errors: upload.status === "PENDING" ? [] : upload.results,
  });
}
