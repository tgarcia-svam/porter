import { Prisma } from "@prisma/client";

// Cap the number of x-axis groups returned for a bar/line chart.
const MAX_GROUPS = 200;
// Only cast strings that look numeric, so a stray non-numeric cell can't abort
// the whole aggregate with a cast error.
const NUM_RE = "^-?[0-9]+(\\.[0-9]+)?$";

// Date bucketing for a DATE x-axis column.
const TRUNC: Record<string, string> = { DAY: "day", MONTH: "month", YEAR: "year" };
const FMT: Record<string, string> = { DAY: "YYYY-MM-DD", MONTH: "YYYY-MM", YEAR: "YYYY" };

export type AggregateFn = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "MEDIAN";
export type Granularity = "DAY" | "MONTH" | "YEAR";
export type VizType = "INDICATOR" | "BAR" | "LINE";

/**
 * A schema's visualization config as read from the DB. Mirrors the `select`
 * used by the callers (dashboard + admin analytics routes).
 */
export type VisualizationConfig = {
  id: string;
  type: VizType;
  title: string;
  aggregate: AggregateFn;
  valueColumn: string;
  xColumn: string | null;
  granularity: Granularity | null;
};

export type VisualizationResult = {
  id: string;
  type: VizType;
  title: string;
  aggregate: AggregateFn;
  value?: number | null; // INDICATOR
  points?: { label: string; value: number }[]; // BAR / LINE
};

// Any Prisma client or interactive-transaction client can run the raw queries;
// the admin analytics route passes `prismaAdmin`, the uploader dashboard passes
// its RLS-scoped transaction client.
type RawClient = Pick<Prisma.TransactionClient, "$queryRaw">;

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

/**
 * Compute a schema's pre-configured visualizations over the rows of one or more
 * uploads. Passing multiple `uploadIds` pools their rows into a single result
 * (used by admin analytics to combine several providers); the uploader
 * dashboard passes a single id. Rows across the given uploads are matched with
 * `"uploadId" = ANY(...)`, so this is behaviour-preserving for the N=1 case.
 */
export async function computeVisualizations(
  client: RawClient,
  uploadIds: string[],
  visualizations: VisualizationConfig[]
): Promise<VisualizationResult[]> {
  if (uploadIds.length === 0 || visualizations.length === 0) return [];

  const out: VisualizationResult[] = [];

  // Run sequentially — a handful of charts on a single shared connection.
  for (const v of visualizations) {
    const fn = v.aggregate;

    if (v.type === "INDICATOR") {
      const rows = await client.$queryRaw<{ value: unknown }[]>`
        SELECT ${aggExpr(fn, v.valueColumn)} AS value
        FROM "UploadRow"
        WHERE "uploadId" = ANY(${uploadIds}::text[]) AND ${valueFilter(fn, v.valueColumn)}
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
      const gran = v.granularity;
      const labelExpr = gran
        ? Prisma.sql`TO_CHAR(DATE_TRUNC(${TRUNC[gran]}, (data->>${xCol})::date), ${FMT[gran]})`
        : Prisma.sql`data->>${xCol}`;
      const xFilter = gran
        ? Prisma.sql`data->>${xCol} <> '' AND (data->>${xCol})::date IS NOT NULL`
        : Prisma.sql`data->>${xCol} IS NOT NULL AND data->>${xCol} <> ''`;

      const rows = await client.$queryRaw<{ label: string; value: unknown }[]>`
        SELECT ${labelExpr} AS label, ${aggExpr(fn, v.valueColumn)} AS value
        FROM "UploadRow"
        WHERE "uploadId" = ANY(${uploadIds}::text[])
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
}
