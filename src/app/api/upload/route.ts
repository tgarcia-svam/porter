import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateFile } from "@/lib/validate";
import { uploadToBlob } from "@/lib/azure-storage";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId: string = session.user.id;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const schemaId = formData.get("schemaId") as string | null;

  if (!file || !schemaId) {
    return NextResponse.json(
      { error: "file and schemaId are required" },
      { status: 400 }
    );
  }

  // Verify schema is assigned to this user
  const assignment = await prisma.userSchemaAssignment.findUnique({
    where: { userId_schemaId: { userId, schemaId } },
  });

  if (!assignment) {
    return NextResponse.json(
      { error: "Schema not assigned to your account" },
      { status: 403 }
    );
  }

  // Fetch schema with columns separately (avoids nested-include type issues)
  const schema = await prisma.schema.findUnique({
    where: { id: schemaId },
    include: { columns: { orderBy: { order: "asc" } } },
  });

  if (!schema) {
    return NextResponse.json({ error: "Schema not found" }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";

  // Build blob path: schemaName/username/datetime/filename
  const sanitize = (s: string) => s.replace(/[/\\?#%]/g, "_").trim() || "_";
  const username = sanitize(session.user.name ?? session.user.email ?? userId);
  const schemaSegment = sanitize(schema.name);
  const now = new Date();
  const datetime = now.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
  const blobName = `${schemaSegment}/${username}/${datetime}/${file.name}`;

  // Upload to Azure — required before DB write
  let blobUrl: string;
  try {
    blobUrl = await uploadToBlob(buffer, blobName, mimeType);
  } catch (err) {
    console.error("Azure upload failed:", err);
    return NextResponse.json(
      { error: "Failed to upload file to storage. Please try again or contact an administrator." },
      { status: 502 }
    );
  }

  // Run validation
  const { errors, rowCount, missingColumns } = validateFile(
    buffer,
    mimeType,
    schema.columns
  );

  // Header-level errors for missing columns (row = 0)
  const allErrors = [
    ...missingColumns.map((col) => ({
      row: 0,
      column: col,
      value: "",
      error: "Required column is missing from the file",
    })),
    ...errors,
  ];

  const isValid = allErrors.length === 0;

  // Persist to DB in a transaction
  const upload = await prisma.$transaction(async (tx) => {
    const record = await tx.fileUpload.create({
      data: {
        userId,
        schemaId,
        fileName: file.name,
        blobUrl,
        status: isValid ? "VALID" : "INVALID",
        errorCount: allErrors.length,
      },
    });

    if (allErrors.length > 0) {
      await tx.validationResult.createMany({
        data: allErrors.map((e) => ({ ...e, uploadId: record.id })),
      });
    }

    return record;
  });

  return NextResponse.json({
    uploadId: upload.id,
    status: upload.status,
    rowCount,
    errorCount: allErrors.length,
    errors: allErrors,
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const uploads = await prisma.fileUpload.findMany({
    where: { userId: session.user.id },
    include: {
      schema: { select: { name: true } },
      results: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(uploads);
}
