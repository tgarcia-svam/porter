/**
 * Shared request validation for a schema's data visualizations (POST + PUT
 * /api/schemas). A visualization aggregates one column of a schema's uploaded
 * data and renders it as an indicator, bar chart, or line chart.
 *
 *   INDICATOR — aggregate `valueColumn` to a single number
 *   BAR / LINE — group by `xColumn`, aggregate `valueColumn` per group
 *
 * `validateVisualizations` is a pure DB-free check (same spirit as
 * checkColumnClassifications in src/lib/classification-compat.ts): it confirms
 * referenced columns exist, Bar/Line have an x-axis, and numeric aggregates run
 * on numeric columns.
 */
import { z } from "zod";

export const VisualizationSchema = z.object({
  type: z.enum(["INDICATOR", "BAR", "LINE"]),
  title: z.string().min(1),
  aggregate: z.enum(["COUNT", "SUM", "AVG", "MIN", "MAX", "MEDIAN"]),
  valueColumn: z.string().min(1),
  xColumn: z.string().nullable().optional(),
  granularity: z.enum(["DAY", "MONTH", "YEAR"]).nullable().optional(),
  order: z.number().int().default(0),
});

export type VisualizationInput = z.infer<typeof VisualizationSchema>;

/** Aggregates that require a numeric column (COUNT works on any column). */
const NUMERIC_AGGREGATES = new Set(["SUM", "AVG", "MIN", "MAX", "MEDIAN"]);

type ColumnRef = { name: string; dataType: string };

/**
 * Returns an error message for the first invalid visualization, or null when
 * every visualization is well-formed against the given columns.
 */
export function validateVisualizations(
  columns: ColumnRef[],
  visualizations: VisualizationInput[]
): string | null {
  const typeByName = new Map(columns.map((c) => [c.name, c.dataType]));

  for (const v of visualizations) {
    const label = v.title.trim() || v.type;

    // COUNT counts all records (valueColumn is the "*" sentinel), so it needs no
    // value column. Every other aggregate runs on a real column.
    if (v.aggregate !== "COUNT") {
      const valueType = typeByName.get(v.valueColumn);
      if (valueType === undefined) {
        return `Visualization "${label}" references an unknown column "${v.valueColumn}".`;
      }
      if (
        NUMERIC_AGGREGATES.has(v.aggregate) &&
        valueType !== "NUMBER" &&
        valueType !== "INTEGER"
      ) {
        return `Visualization "${label}" uses ${v.aggregate} on the non-numeric column "${v.valueColumn}".`;
      }
    }

    if (v.type === "BAR" || v.type === "LINE") {
      if (!v.xColumn) {
        return `Visualization "${label}" (${v.type.toLowerCase()}) requires an x-axis column.`;
      }
      const xType = typeByName.get(v.xColumn);
      if (xType === undefined) {
        return `Visualization "${label}" references an unknown x-axis column "${v.xColumn}".`;
      }
      // Date bucketing only applies to a DATE x-axis column.
      if (v.granularity && xType !== "DATE") {
        return `Visualization "${label}" can only group by day/month/year when its x-axis column is a date.`;
      }
    } else if (v.granularity) {
      return `Visualization "${label}" can only use date grouping on a bar or line chart.`;
    }
  }
  return null;
}
