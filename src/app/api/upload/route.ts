import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateFile } from "@/lib/validate";
import { uploadToBlob, waitForMalwareScanResult, deleteBlobByName } from "@/lib/azure-storage";
import { auditStore, clientIp } from "@/lib/audit-context";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId: string = session.user.id;
  auditStore.enterWith({
    userId,
    userEmail: session.user.email ?? undefined,
    ip: clientIp(req),
  });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const schemaId = formData.get("schemaId") as string | null;
  const sheetName = (formData.get("sheetName") as string | null) ?? undefined;

  if (!file || !schemaId) {
    return NextResponse.json(
      { error: "file and schemaId are required" },
      { status: 400 }
    );
  }

  // Verify access: user must belong to an org linked to a project that contains this schema
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: { select: { name: true } } },
  });

  if (!user?.organization) {
    return NextResponse.json(
      { error: "You must belong to an organization to upload files" },
      { status: 403 }
    );
  }

  const access = await prisma.schemaProject.findFirst({
    where: {
      schemaId,
      project: {
        organizations: { some: { organizationId: user.organizationId! } },
      },
    },
  });

  if (!access) {
    return NextResponse.json(
      { error: "Schema not accessible to your organization" },
      { status: 403 }
    );
  }

  // Fetch schema with columns and projects
  const schema = await prisma.schema.findUnique({
    where: { id: schemaId },
    include: {
      columns: { orderBy: { order: "asc" } },
      projects: { include: { project: { select: { name: true } } } },
    },
  });

  if (!schema) {
    return NextResponse.json({ error: "Schema not found" }, { status: 404 });
  }

  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File exceeds the 100 MB size limit." },
      { status: 413 }
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  const allowedExts = ["csv", "xlsx", "xls"];
  const allowedMimes = [
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ];
  if (!allowedExts.includes(ext ?? "") && !allowedMimes.includes(file.type)) {
    return NextResponse.json(
      { error: "Only CSV and Excel files (.csv, .xlsx, .xls) are allowed." },
      { status: 415 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";

  // Build blob path: project/organization/schema/datetime/filename
  const sanitize = (s: string) => s.replace(/[/\\?#%]/g, "_").trim() || "_";
  const projectNames = schema.projects.map((sp) => sanitize(sp.project.name));
  const projectSegment = projectNames.length > 0 ? projectNames.join("+") : "no-project";
  const orgSegment = sanitize(user?.organization?.name ?? "no-organization");
  const schemaSegment = sanitize(schema.name);
  const now = new Date();
  const datetime = now.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
  const blobName = `${projectSegment}/${orgSegment}/${schemaSegment}/${datetime}/${file.name}`;

  // Upload to Azure first; malware scanning is handled by Azure Defender for Storage
  let blobUrl: string;
  try {
    blobUrl = await uploadToBlob(buffer, blobName, mimeType);
  } catch (err: unknown) {
    console.error("Azure upload failed:", err);
    return NextResponse.json(
      { error: "File storage is not configured. Please contact an administrator." },
      { status: 503 }
    );
  }

  // Wait for Defender for Storage malware scan result
  const scanResult = await waitForMalwareScanResult(blobName);
  if (scanResult === "malicious") {
    await deleteBlobByName(blobName);
    return NextResponse.json(
      { error: "File rejected: malware detected." },
      { status: 422 }
    );
  }
  // "clean" or "pending" (Defender not configured) — proceed

  // Validate file contents
  const { errors, errorsCapped, rowCount, missingColumns, rows } = await validateFile(
    buffer,
    mimeType,
    schema.columns,
    sheetName
  );

  const missingColumnErrors = missingColumns.map((col) => ({
    row: 0,
    column: col,
    value: "",
    error: "Required column is missing from the file",
  }));

  const allErrors = [...missingColumnErrors, ...errors];
  const isValid = allErrors.length === 0;

  // Create the FileUpload record and any validation errors
  const record = await prisma.fileUpload.create({
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
    await prisma.validationResult.createMany({
      data: allErrors.map((e) => ({ ...e, uploadId: record.id })),
    });
  }

  // Insert valid rows in chunks to avoid single oversized transactions
  const CHUNK_SIZE = 1_000;
  if (isValid && rows.length > 0) {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      await prisma.uploadRow.createMany({
        data: chunk.map((row, j) => ({
          uploadId: record.id,
          rowIndex: i + j + 1,
          data: row,
        })),
      });
    }
  }

  const upload = record;

  return NextResponse.json({
    uploadId: upload.id,
    status: upload.status,
    rowCount,
    errorCount: allErrors.length,
    errorsCapped,
    errors: allErrors,
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });

  const uploads = await prisma.fileUpload.findMany({
    where: currentUser?.organizationId
      ? { user: { organizationId: currentUser.organizationId } }
      : { userId: session.user.id },
    include: {
      schema: { select: { name: true } },
      results: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(uploads);
}
