"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const BRAND = "#09a2c5";

export type VizType = "INDICATOR" | "BAR" | "LINE";
export type AggregateFn = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "MEDIAN";

export type Visualization = {
  id: string;
  type: VizType;
  title: string;
  aggregate: AggregateFn;
  value?: number | null; // INDICATOR
  points?: { label: string; value: number }[]; // BAR / LINE
};

/** Aggregates whose result can be fractional → show a couple of decimals. */
const FRACTIONAL = new Set<AggregateFn>(["AVG", "MEDIAN"]);

function formatValue(value: number | null | undefined, aggregate: AggregateFn): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: FRACTIONAL.has(aggregate) ? 2 : 0,
  });
}

function IndicatorCard({ v }: { v: Visualization }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col justify-between">
      <p className="text-xs font-medium text-gray-500">{v.title}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{formatValue(v.value, v.aggregate)}</p>
    </div>
  );
}

function ChartCard({ v }: { v: Visualization }) {
  const points = v.points ?? [];
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
      <p className="text-sm font-semibold text-gray-900">{v.title}</p>
      {points.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">No data for this chart.</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          {v.type === "BAR" ? (
            <BarChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" name={v.title} fill={BRAND} radius={[3, 3, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" name={v.title} stroke={BRAND} strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  );
}

/**
 * Presentational grid of pre-configured visualizations. Assumes a non-empty
 * list (callers handle the empty / no-data states). Preserves the admin-chosen
 * order: indicators occupy one column; charts span the full two-column width.
 */
export default function VisualizationGrid({ visualizations }: { visualizations: Visualization[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {visualizations.map((v) =>
        v.type === "INDICATOR" ? (
          <IndicatorCard key={v.id} v={v} />
        ) : (
          <div key={v.id} className="lg:col-span-2">
            <ChartCard v={v} />
          </div>
        )
      )}
    </div>
  );
}
