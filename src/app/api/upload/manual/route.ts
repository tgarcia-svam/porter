import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateFile } from "@/lib/validate";
import { uploadToBlob } from "@/lib/azure-storage";
import Papa from "papaparse";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId: string = session.user.id;

  const body = (await req.json()) as {
    schemaId?: string;
    rows?: Record<string, string>[];
  };
  const { schemaId, rows } = body;

  if (!schemaId || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: "schemaId and at least one row are required" },
      { status: 400 }
    );
  }

  // Verify access: user must belong to an org linked to a project with this schema
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: { select: { name: true } } },
  });

  if (!user?.organization) {
    return NextResponse.json(
      { error: "You must belong to an organization to submit data" },
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

  // Convert rows to CSV with schema-ordered columns as headers
  const columnNames = schema.columns.map((c) => c.name);
  const csv = Papa.unparse({
    fields: columnNames,
    data: rows.map((row) => columnNames.map((name) => row[name] ?? "")),
  });
  const buffer = Buffer.from(csv, "utf-8");

  const { errors, rowCount, missingColumns } = validateFile(
    buffer,
    "text/csv",
    schema.columns
  );

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

  const sanitize = (s: string) => s.replace(/[/\\?#%]/g, "_").trim() || "_";
  const projectNames = schema.projects.map((sp) => sanitize(sp.project.name));
  const projectSegment = projectNames.length > 0 ? projectNames.join("+") : "no-project";
  const orgSegment = sanitize(user.organization.name);
  const schemaSegment = sanitize(schema.name);
  const now = new Date();
  const datetime = now.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
  const fileName = `manual-entry-${datetime}.csv`;
  const prefix = isValid ? "valid" : "error";
  const blobName = `${prefix}/${projectSegment}/${orgSegment}/${schemaSegment}/${datetime}/${fileName}`;

  let blobUrl: string;
  try {
    blobUrl = await uploadToBlob(buffer, blobName, "text/csv");
  } catch (err) {
    console.error("Azure upload failed:", err);
    return NextResponse.json(
      { error: "Failed to upload to storage. Please try again or contact an administrator." },
      { status: 502 }
    );
  }

  const upload = await prisma.$transaction(async (tx) => {
    const record = await tx.fileUpload.create({
      data: {
        userId,
        schemaId,
        fileName,
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
