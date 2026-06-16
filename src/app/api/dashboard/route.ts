import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prismaAdmin } from "@/lib/prisma-admin";
import { withOrgContext } from "@/lib/with-org-context";
import { verifySessionBinding } from "@/lib/session-binding";
import { logAuthEvent } from "@/lib/auth-audit";
import { clientIp } from "@/lib/audit-context";
import { apiUnauthorized, apiBadRequest, apiNotFound, withHandler } from "@/lib/api-error";

// Cap the number of x-axis groups returned for a bar/line chart.
const MAX_GROUPS = 200;
// Only cast strings that look numeric, so a stray non-numeric cell can't abort
// the whole aggregate with a cast error.
const NUM_RE = "^-?[0-9]+(\\.[0-9]+)?$";

// Date bucketing for a DATE x-axis column.
const TRUNC: Record<string, string> = { DAY: "day", MONTH: "month", YEAR: "year" };
const FMT: Record<string, string> = { DAY: "YYYY-MM-DD", MONTH: "YYYY-MM", YEAR: "YYYY" };

type AggregateFn = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "MEDIAN";
type Granularity = "DAY" | "MONTH" | "YEAR";

/**
 * The aggregate SQL fragment. The function name is a fixed literal (never user
 * input); the column name is a bound parameter via Prisma.sql, so this is
 * injection-safe.
 */
function aggExpr(fn: AggregateFn, valueCol: string): Prisma.Sql {
  switch (fn) {
    case "COUNT":
      return Prisma.sql`COUNT(*)`;
    case "SUM":
      return Prisma.sql`SUM((data->>${valueCol})::numeric)`;
    case "AVG":
      return Prisma.sql`AVG((data->>${valueCol})::numeric)`;
    case "MIN":
      return Prisma.sql`MIN((data->>${valueCol})::numeric)`;
    case "MAX":
      return Prisma.sql`MAX((data->>${valueCol})::numeric)`;
    case "MEDIAN":
      return Prisma.sql`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (data->>${valueCol})::numeric)`;
  }
}

/** Rows the aggregate can legitimately consume (non-empty, numeric where required). */
function valueFilter(fn: AggregateFn, valueCol: string): Prisma.Sql {
  // COUNT counts all records — no value column, no filter.
  if (fn === "COUNT") return Prisma.sql`TRUE`;
  return Prisma.sql`data->>${valueCol} ~ ${NUM_RE}`;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const GET = withHandler(async (req: NextRequest) => {
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

  const { searchParams } = req.nextUrl;
  const schemaId = searchParams.get("schemaId");
  const projectId = searchParams.get("projectId");
  if (!schemaId || !projectId) return apiBadRequest("schemaId and projectId are required");

  // User → org lookup happens outside RLS (no context yet).
  const currentUser = await prismaAdmin.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });
  if (!currentUser?.organizationId) {
    return NextResponse.json({ hasData: false, visualizations: [] });
  }

  // Visualization config is admin-owned — bypass RLS to read it.
  const schema = await prismaAdmin.schema.findUnique({
    where: { id: schemaId },
    select: {
      visualizations: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          type: true,
          title: true,
          aggregate: true,
          valueColumn: true,
          xColumn: true,
          granularity: true,
        },
      },
    },
  });
  if (!schema) return apiNotFound("Schema not found");

  if (schema.visualizations.length === 0) {
    return NextResponse.json({ hasData: false, visualizations: [] });
  }

  // All upload-data reads enforce org isolation via RLS.
  const result = await withOrgContext(
    currentUser.organizationId,
    async (tx) => {
      const upload = await tx.fileUpload.findFirst({
        where: {
          schemaId,
          status: "VALID",
          deletedAt: null,
          schema: { projects: { some: { projectId } } },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!upload) return null;

      const uploadId = upload.id;
      const out = [];

      // Run sequentially — a handful of charts on a single shared connection.
      for (const v of schema.visualizations) {
        const fn = v.aggregate as AggregateFn;

        if (v.type === "INDICATOR") {
          const rows = await tx.$queryRaw<{ value: unknown }[]>`
            SELECT ${aggExpr(fn, v.valueColumn)} AS value
            FROM "UploadRow"
            WHERE "uploadId" = ${uploadId} AND ${valueFilter(fn, v.valueColumn)}
          `;
          out.push({
            id: v.id,
            type: v.type,
            title: v.title,
            aggregate: v.aggregate,
            value: toNumber(rows[0]?.value),
          });
        } else {
          const xCol = v.xColumn!;
          // For a DATE x-axis the admin can bucket by day/month/year; otherwise
          // group by the raw cell value.
          const gran = v.granularity as Granularity | null;
          const labelExpr = gran
            ? Prisma.sql`TO_CHAR(DATE_TRUNC(${TRUNC[gran]}, (data->>${xCol})::date), ${FMT[gran]})`
            : Prisma.sql`data->>${xCol}`;
          const xFilter = gran
            ? Prisma.sql`data->>${xCol} <> '' AND (data->>${xCol})::date IS NOT NULL`
            : Prisma.sql`data->>${xCol} IS NOT NULL AND data->>${xCol} <> ''`;

          const rows = await tx.$queryRaw<{ label: string; value: unknown }[]>`
            SELECT ${labelExpr} AS label, ${aggExpr(fn, v.valueColumn)} AS value
            FROM "UploadRow"
            WHERE "uploadId" = ${uploadId}
              AND ${xFilter}
              AND ${valueFilter(fn, v.valueColumn)}
            GROUP BY 1
            ORDER BY 1
            LIMIT ${MAX_GROUPS}
          `;
          out.push({
            id: v.id,
            type: v.type,
            title: v.title,
            aggregate: v.aggregate,
            points: rows.map((r) => ({ label: r.label, value: toNumber(r.value) ?? 0 })),
          });
        }
      }

      return out;
    },
    session.user.id
  );

  if (!result) return NextResponse.json({ hasData: false, visualizations: [] });
  return NextResponse.json({ hasData: true, visualizations: result });
});
