import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const schemaId = req.nextUrl.searchParams.get("schemaId");
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!schemaId || !projectId) {
    return NextResponse.json({ error: "schemaId and projectId are required" }, { status: 400 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });

  if (!currentUser?.organizationId) {
    return NextResponse.json({ rows: [] });
  }

  // Find the latest valid upload for this schema + project + org
  const upload = await prisma.fileUpload.findFirst({
    where: {
      schemaId,
      status: "VALID",
      user: { organizationId: currentUser.organizationId },
      schema: { projects: { some: { projectId } } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!upload) {
    return NextResponse.json({ rows: [] });
  }

  // Fetch its rows from the UploadRow table (separate query avoids stale-type issues)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uploadRows = await (prisma as any).uploadRow.findMany({
    where: { uploadId: upload.id },
    orderBy: { rowIndex: "asc" },
  });

  return NextResponse.json({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: uploadRows.map((r: any) => r.data),
  });
}
