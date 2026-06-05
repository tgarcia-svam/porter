/**
 * POST /api/upload/manual
 *
 * Applies a diff (edits + additions + deletions) to the latest VALID upload
 * for this schema, then writes the merged dataset as a new FileUpload version.
 * If no prior upload exists, `additions` become the initial dataset.
 *
 * Request body:
 *   {
 *     schemaId: string,
 *     edits?:     [{ rowIndex: number, data: Record<string, string> }],
 *     additions?: [{                    data: Record<string, string> }],
 *     deletions?: number[]   // rowIndex values to remove
 *   }
 *
 * This replaces the prior "send all rows" contract that silently truncated
 * datasets larger than the client could load.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { validateFile } from "@/lib/validate";
import { uploadToBlob } from "@/lib/azure-storage";
import { exportUploadToWarehouse } from "@/lib/warehouse-export";
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

const RowData = z.record(z.string(), z.string());

const Body = z.object({
  schemaId: z.string(),
  edits: z.array(z.object({ rowIndex: z.number().int().nonnegative(), data: RowData })).optional(),
  additions: z.array(z.object({ data: RowData })).optional(),
  deletions: z.array(z.number().int().nonnegative()).optional(),
});

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

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const { schemaId, edits = [], additions = [], deletions = [] } = parsed.data;
  if (edits.length === 0 && additions.length === 0 && deletions.length === 0) {
    return apiBadRequest("At least one of edits, additions, or deletions is required");
  }

  // Access checks unchanged from prior version.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: { select: { name: true } } },
  });
  if (!user?.organization) return apiForbidden("You must belong to an organization to submit data");

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

  // ── Materialise the merged dataset ────────────────────────────────────────
  // 1. Read the prior dataset (latest VALID upload for this schema + org).
  //    Empty if none exists — additions become the initial dataset.
  const prior = await prisma.fileUpload.findFirst({
    where: {
      schemaId,
      status: "VALID",
      deletedAt: null,
      user: { organizationId: user.organizationId! },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const priorRows: { rowIndex: number; data: Record<string, string> }[] = prior
    ? await prisma.uploadRow.findMany({
        where: { uploadId: prior.id },
        orderBy: { rowIndex: "asc" },
        select: { rowIndex: true, data: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any
    : [];

  // 2. Apply deletions, then edits, then keep additions. Renumber 1..N.
  const editMap = new Map(edits.map((e) => [e.rowIndex, e.data]));
  const deleteSet = new Set(deletions);

  const mergedRows: Record<string, string>[] = [];
  for (const r of priorRows) {
    if (deleteSet.has(r.rowIndex)) continue;
    mergedRows.push(editMap.get(r.rowIndex) ?? r.data);
  }
  for (const a of additions) mergedRows.push(a.data);

  if (mergedRows.length === 0) {
    return apiBadRequest("Merged dataset would be empty — refusing to save");
  }

  // ── Convert to CSV → validate → write new upload ──────────────────────────
  const columnNames = schema.columns.map((c) => c.name);
  const csv = Papa.unparse({
    fields: columnNames,
    data: mergedRows.map((row) => columnNames.map((name) => row[name] ?? "")),
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

  // Best-effort warehouse export (never throws).
  if (upload.status === "VALID") {
    await exportUploadToWarehouse(upload.id);
  }

  return NextResponse.json({
    uploadId: upload.id,
    status: upload.status,
    rowCount,
    errorCount: allErrors.length,
    errorsCapped,
    errors: allErrors,
  });
});
