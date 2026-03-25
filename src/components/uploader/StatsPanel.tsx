"use client";

import { useEffect, useState } from "react";

type TimeSeriesPoint = { label: string; count: number };

type StatsData = {
  totalCount: number;
  granularity: "DAY" | "MONTH" | "YEAR" | null;
  timeSeries: TimeSeriesPoint[];
};

// ── Gap filling ───────────────────────────────────────────────────────────────

function parseLabel(label: string, granularity: string): Date {
  if (granularity === "YEAR")  return new Date(Number(label), 0, 1);
  if (granularity === "MONTH") { const [y, m] = label.split("-"); return new Date(Number(y), Number(m) - 1, 1); }
  const [y, m, d] = label.split("-"); return new Date(Number(y), Number(m) - 1, Number(d));
}

function formatLabel(date: Date, granularity: string): string {
  if (granularity === "YEAR")  return String(date.getFullYear());
  if (granularity === "MONTH") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function increment(date: Date, granularity: string): Date {
  const d = new Date(date);
  if (granularity === "YEAR")  { d.setFullYear(d.getFullYear() + 1); return d; }
  if (granularity === "MONTH") { d.setMonth(d.getMonth() + 1); return d; }
  d.setDate(d.getDate() + 1); return d;
}

function fillGaps(points: TimeSeriesPoint[], granularity: string): TimeSeriesPoint[] {
  if (points.length === 0) return [];
  const map = new Map(points.map((p) => [p.label, p.count]));
  const result: TimeSeriesPoint[] = [];
  let current = parseLabel(points[0].label, granularity);
  const end = parseLabel(points[points.length - 1].label, granularity);
  while (current <= end) {
    const label = formatLabel(current, granularity);
    result.push({ label, count: map.get(label) ?? 0 });
    current = increment(current, granularity);
  }
  return result;
}

// ── X-axis label formatting ───────────────────────────────────────────────────

function displayLabel(label: string, granularity: string): string {
  if (granularity === "YEAR") return label;
  if (granularity === "MONTH") {
    const [y, m] = label.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString("default", { month: "short", year: "numeric" });
  }
  const [y, m, d] = label.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleString("default", { month: "short", day: "numeric" });
}

// ── SVG line chart ────────────────────────────────────────────────────────────

const W = 500, H = 100;
const PAD = { top: 8, right: 8, bottom: 20, left: 8 };
const CW = W - PAD.left - PAD.right;
const CH = H - PAD.top - PAD.bottom;

function LineChart({ points, granularity }: { points: TimeSeriesPoint[]; granularity: string }) {
  if (points.length < 2) return null;

  const max = Math.max(...points.map((p) => p.count), 1);
  const xOf = (i: number) => PAD.left + (i / (points.length - 1)) * CW;
  const yOf = (v: number) => PAD.top + CH - (v / max) * CH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(p.count)}`).join(" ");
  const areaPath = `${linePath} L ${xOf(points.length - 1)} ${PAD.top + CH} L ${xOf(0)} ${PAD.top + CH} Z`;

  // Pick x-axis label indices: first, last, and up to 3 evenly spaced in between
  const labelIndices = new Set([0, points.length - 1]);
  if (points.length > 2) {
    const steps = Math.min(3, points.length - 2);
    for (let s = 1; s <= steps; s++) {
      labelIndices.add(Math.round((s / (steps + 1)) * (points.length - 1)));
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="overflow-visible">
      <defs>
        <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#3b82f6" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Area fill */}
      <path d={areaPath} fill="url(#area-fill)" />

      {/* Grid line at zero */}
      <line
        x1={PAD.left} y1={PAD.top + CH}
        x2={PAD.left + CW} y2={PAD.top + CH}
        stroke="#e5e7eb" strokeWidth="1"
      />

      {/* Line */}
      <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

      {/* Dots at each point */}
      {points.map((p, i) => (
        <circle key={i} cx={xOf(i)} cy={yOf(p.count)} r="2.5" fill="#3b82f6">
          <title>{`${displayLabel(p.label, granularity)}: ${p.count.toLocaleString()}`}</title>
        </circle>
      ))}

      {/* X-axis labels */}
      {[...labelIndices].sort((a, b) => a - b).map((i) => (
        <text
          key={i}
          x={xOf(i)}
          y={H}
          textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
          fontSize="9"
          fill="#9ca3af"
        >
          {displayLabel(points[i].label, granularity)}
        </text>
      ))}
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StatsPanel({ schemaId, projectId }: { schemaId: string; projectId: string }) {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/api/stats?schemaId=${schemaId}&projectId=${projectId}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [schemaId, projectId]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-32 mb-4" />
        <div className="h-8 bg-gray-100 rounded w-24" />
      </div>
    );
  }

  if (!data || data.totalCount === 0) return null;

  const filled = data.granularity && data.timeSeries.length > 1
    ? fillGaps(data.timeSeries, data.granularity)
    : data.timeSeries;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <h2 className="font-semibold text-gray-900">Current Data</h2>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-gray-900">{data.totalCount.toLocaleString()}</span>
        <span className="text-sm text-gray-500">records</span>
      </div>

      {filled.length > 1 && data.granularity && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-500">Records over time</p>
          <LineChart points={filled} granularity={data.granularity} />
        </div>
      )}
    </div>
  );
}
