import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
// TODO(RLS): refactor to withOrgContext once the upload pipeline is split.
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { validateFile } from "@/lib/validate";
import { uploadToBlob } from "@/lib/azure-storage";
import { verifySessionBinding } from "@/lib/session-binding";
import { logAuthEvent } from "@/lib/auth-audit";
import { auditStore, clientIp } from "@/lib/audit-context";
import { apiUnauthorized, apiForbidden, apiBadRequest, apiNotFound, apiBadGateway, withHandler } from "@/lib/api-error";
import {
  resolveValidationColumns,
  buildUploadBlobName,
  toMissingColumnErrors,
  createUploadWithResults,
  uploadDatetime,
} from "@/lib/upload-service";
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

  const columnsForValidation = await resolveValidationColumns(schema.columns);

  const { errors, errorsCapped, rowCount, missingColumns, rows: validatedRows } = await validateFile(
    buffer,
    "text/csv",
    columnsForValidation
  );

  const allErrors = [...toMissingColumnErrors(missingColumns), ...errors];
  const isValid = allErrors.length === 0;

  const datetime = uploadDatetime();
  const fileName = `manual-entry-${datetime}.csv`;
  const { blobName } = buildUploadBlobName({
    projectNames: schema.projects.map((sp) => sp.project.name),
    orgName: user.organization.name,
    schemaName: schema.name,
    fileName,
    prefix: isValid ? "valid" : "error",
    datetime,
  });

  let blobUrl: string;
  try {
    blobUrl = await uploadToBlob(buffer, blobName, "text/csv");
  } catch (err) {
    console.error("Azure upload failed:", err);
    return apiBadGateway("Failed to upload to storage. Please try again or contact an administrator.");
  }

  const upload = await createUploadWithResults({
    userId,
    schemaId,
    schemaVersion: schema.version,
    fileName,
    blobUrl,
    rowCount,
    errorsCapped,
    errors: allErrors,
    rows: validatedRows,
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
