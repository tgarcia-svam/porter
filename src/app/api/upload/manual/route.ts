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
import { prismaAdmin } from "@/lib/prisma-admin";
import { withOrgContext } from "@/lib/with-org-context";
import { validateRows } from "@/lib/validate";
import { uploadToBlob } from "@/lib/azure-storage";
import { exportUploadToWarehouse } from "@/lib/warehouse-export";
import { logger } from "@/lib/logger";
import { verifySessionBinding } from "@/lib/session-binding";
import { logAuthEvent } from "@/lib/auth-audit";
import { auditStore, clientIp } from "@/lib/audit-context";
import { apiUnauthorized, apiForbidden, apiBadRequest, apiNotFound, apiBadGateway, withHandler } from "@/lib/api-error";
import {
  resolveValidationColumns,
  resolveSchemaComparisons,
  buildUploadBlobName,
  toMissingColumnErrors,
  createUploadWithResults,
  uploadDatetime,
} from "@/lib/upload-service";
import Papa from "papaparse";

const RowData = z.record(z.string(), z.string());

const Body = z.object({
  schemaId: z.string(),
  projectId: z.string().optional(),
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

  const { schemaId, projectId = null, edits = [], additions = [], deletions = [] } = parsed.data;
  if (edits.length === 0 && additions.length === 0 && deletions.length === 0) {
    return apiBadRequest("At least one of edits, additions, or deletions is required");
  }

  // prismaAdmin for User/Schema/SchemaProject — these are admin-owned config,
  // not user data, so they live outside the RLS boundary.
  const user = await prismaAdmin.user.findUnique({
    where: { id: userId },
    include: { organization: { select: { name: true } } },
  });
  if (!user?.organization) return apiForbidden("You must belong to an organization to submit data");

  const access = await prismaAdmin.schemaProject.findFirst({
    where: {
      schemaId,
      ...(projectId ? { projectId } : {}),
      schema: { deletedAt: null },
      project: { deletedAt: null, organizations: { some: { organizationId: user.organizationId! } } },
    },
  });
  if (!access) return apiForbidden("Schema not accessible to your organization");

  const schema = await prismaAdmin.schema.findUnique({
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
  //
  // withOrgContext so the RLS policy enforces org isolation on these reads at
  // the database level, independent of the application-layer access check above.
  type PriorRow = { rowIndex: number; data: Record<string, string> };
  const { prior, priorRows } = await withOrgContext(
    user.organizationId!,
    async (tx) => {
      const prior = await tx.fileUpload.findFirst({
        where: { schemaId, status: "VALID", deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const priorRows: PriorRow[] = prior
        ? (await tx.uploadRow.findMany({
            where: { uploadId: prior.id },
            orderBy: { rowIndex: "asc" },
            select: { rowIndex: true, data: true },
          })) as PriorRow[]
        : [];
      return { prior, priorRows };
    },
    userId,
  );

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

  // ── Validate → write new upload ───────────────────────────────────────────
  // validateRows() works on the in-memory row objects directly — no need to
  // unparse to CSV and re-parse it just to run the same checks.
  const columnNames = schema.columns.map((c) => c.name);

  const [columnsForValidation, comparisons] = await Promise.all([
    resolveValidationColumns(schema.columns),
    resolveSchemaComparisons(schemaId),
  ]);

  const { errors, errorsCapped, rowCount, missingColumns, rows: validatedRows } =
    validateRows(mergedRows, columnsForValidation, comparisons);

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

  // Persist the upload record now (blobUrl populated in the background).
  const upload = await createUploadWithResults({
    userId,
    schemaId,
    projectId,
    schemaVersion: schema.version,
    fileName,
    blobUrl: null,
    rowCount,
    errorsCapped,
    errors: allErrors,
    rows: validatedRows,
  });

  // Background: serialise → blob upload → DB patch → warehouse export.
  // The blob is an audit artifact; the validated rows are already in the DB.
  // Runs after the response is sent so the client is not blocked.
  void (async () => {
    try {
      const csv = Papa.unparse({
        fields: columnNames,
        data: mergedRows.map((row) => columnNames.map((name) => row[name] ?? "")),
      });
      const blobUrl = await uploadToBlob(Buffer.from(csv, "utf-8"), blobName, "text/csv");
      await prismaAdmin.fileUpload.update({ where: { id: upload.id }, data: { blobUrl } });
      if (upload.status === "VALID") await exportUploadToWarehouse(upload.id);
    } catch (err) {
      logger.error(
        "[upload/manual] Background blob/export failed",
        err instanceof Error ? err : undefined,
        { uploadId: upload.id, detail: err instanceof Error ? undefined : String(err) },
      );
    }
  })();

  return NextResponse.json({
    uploadId: upload.id,
    status: upload.status,
    rowCount,
    errorCount: allErrors.length,
    errorsCapped,
    errors: allErrors,
  });
});
