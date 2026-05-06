import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateFile } from "@/lib/validate";
import { uploadToBlob } from "@/lib/azure-storage";
import { verifySessionBinding } from "@/lib/session-binding";
import { logAuthEvent } from "@/lib/auth-audit";
import { auditStore, clientIp } from "@/lib/audit-context";
import { apiUnauthorized, apiForbidden, apiBadRequest, apiNotFound, apiBadGateway, withHandler } from "@/lib/api-error";
import Papa from "papaparse";

export const POST = withHandler(async (req: NextRequest) => {
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

  const userId: string = session.user.id;
  auditStore.enterWith({ userId, userEmail: session.user.email ?? undefined, ip: clientIp(req) });

  const body = (await req.json()) as {
    schemaId?: string;
    rows?: Record<string, string>[];
  };
  const { schemaId, rows } = body;

  if (!schemaId || !Array.isArray(rows) || rows.length === 0) {
    return apiBadRequest("schemaId and at least one row are required");
  }

  // Verify access: user must belong to an org linked to a project with this schema
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: { select: { name: true } } },
  });

  if (!user?.organization) {
    return apiForbidden("You must belong to an organization to submit data");
  }

  const access = await prisma.schemaProject.findFirst({
    where: {
      schemaId,
      schema: { deletedAt: null },
      project: { deletedAt: null, organizations: { some: { organizationId: user.organizationId! } } },
    },
  });

  if (!access) return apiForbidden("Schema not accessible to your organization");

  const schema = await prisma.schema.findUnique({
    where: { id: schemaId },
    include: {
      columns: { orderBy: { order: "asc" } },
      projects: { include: { project: { select: { name: true } } } },
    },
  });

  if (!schema) return apiNotFound("Schema not found");

  // Convert rows to CSV with schema-ordered columns as headers
  const columnNames = schema.columns.map((c) => c.name);
  const csv = Papa.unparse({
    fields: columnNames,
    data: rows.map((row) => columnNames.map((name) => row[name] ?? "")),
  });
  const buffer = Buffer.from(csv, "utf-8");

  // Enrich columns with classification allowed values (separate query per MEMORY guidance)
  const classificationIds = schema.columns
    .map((c) => c.classificationId)
    .filter((id): id is string => id !== null && id !== undefined);

  const classMap = new Map<string, { values: string[]; caseSensitive: boolean }>();
  if (classificationIds.length > 0) {
    const clsfs = await prisma.classification.findMany({
      where: { id: { in: classificationIds } },
      select: { id: true, values: true, caseSensitive: true },
    });
    for (const clf of clsfs) classMap.set(clf.id, { values: clf.values, caseSensitive: clf.caseSensitive });
  }

  const columnsForValidation = schema.columns.map((c) => {
    const clf = c.classificationId ? classMap.get(c.classificationId) : null;
    return { ...c, allowedValues: clf?.values ?? null, caseSensitive: clf?.caseSensitive ?? null };
  });

  const { errors, errorsCapped, rowCount, missingColumns, rows: validatedRows } = await validateFile(
    buffer,
    "text/csv",
    columnsForValidation
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
    return apiBadGateway("Failed to upload to storage. Please try again or contact an administrator.");
  }

  const upload = await prisma.$transaction(async (tx) => {
    const record = await tx.fileUpload.create({
      data: {
        userId,
        schemaId,
        schemaVersion: schema.version,
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

    if (isValid && validatedRows.length > 0) {
      await tx.uploadRow.createMany({
        data: validatedRows.map((row, idx) => ({
          uploadId: record.id,
          rowIndex: idx + 1,
          data: row,
        })),
      });
    }

    return record;
  });

  return NextResponse.json({
    uploadId: upload.id,
    status: upload.status,
    rowCount,
    errorCount: allErrors.length,
    errorsCapped,
    errors: allErrors,
  });
});
