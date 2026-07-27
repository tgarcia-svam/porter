"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

type DataType = "TEXT" | "NUMBER" | "INTEGER" | "BOOLEAN" | "DATE" | "EMAIL";
type ComparisonOperator = "LT" | "LTE" | "GT" | "GTE";

type ColumnDef = {
  name: string;
  dataType: DataType;
  required: boolean;
  classificationId: string | null;
};

type ComparisonDef = {
  id?: string;
  sourceColumnName: string;
  operator: ComparisonOperator;
  targetColumnName: string;
};

type ClassificationType = "VALUE_LIST" | "REGEX" | "NUMBER_RANGE" | "DATE_RANGE";
type ProjectRef = { id: string; name: string };
type ClassificationRef = { id: string; name: string; type: ClassificationType };

type VizType = "INDICATOR" | "BAR" | "LINE";
type AggregateFn = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "MEDIAN";
type Granularity = "DAY" | "MONTH" | "YEAR";

type VizDef = {
  title: string;
  type: VizType;
  aggregate: AggregateFn;
  valueColumn: string;
  xColumn: string | null;
  granularity: Granularity | null;
};

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: "DAY", label: "Day" },
  { value: "MONTH", label: "Month" },
  { value: "YEAR", label: "Year" },
];

const VIZ_TYPES: { value: VizType; label: string }[] = [
  { value: "INDICATOR", label: "Indicator" },
  { value: "BAR", label: "Bar" },
  { value: "LINE", label: "Line" },
];

const AGGREGATES: { value: AggregateFn; label: string }[] = [
  { value: "COUNT", label: "Count" },
  { value: "SUM", label: "Sum" },
  { value: "AVG", label: "Average" },
  { value: "MIN", label: "Min" },
  { value: "MAX", label: "Max" },
  { value: "MEDIAN", label: "Median" },
];

const COMPARISON_OPERATORS: { value: ComparisonOperator; label: string }[] = [
  { value: "LT",  label: "<"  },
  { value: "LTE", label: "≤"  },
  { value: "GT",  label: ">"  },
  { value: "GTE", label: "≥"  },
];

const COMPARISON_OPERATOR_LABELS: Record<ComparisonOperator, string> = {
  LT: "<", LTE: "≤", GT: ">", GTE: "≥",
};

const NUMERIC_AGGREGATES = new Set<AggregateFn>(["SUM", "AVG", "MIN", "MAX", "MEDIAN"]);
const isNumericType = (dt: DataType) => dt === "NUMBER" || dt === "INTEGER";

function getTypeGroup(dt: DataType): "numeric" | "date" | null {
  if (dt === "NUMBER" || dt === "INTEGER") return "numeric";
  if (dt === "DATE") return "date";
  return null;
}

function compatibleClassificationTypes(dataType: DataType): ClassificationType[] {
  switch (dataType) {
    case "TEXT":
    case "EMAIL":
      return ["VALUE_LIST", "REGEX"];
    case "NUMBER":
    case "INTEGER":
      return ["NUMBER_RANGE"];
    case "DATE":
      return ["DATE_RANGE"];
    default:
      return [];
  }
}

type InitialData = {
  id: string;
  name: string;
  description: string;
  projectIds: string[];
  columns: ColumnDef[];
  visualizations: VizDef[];
  comparisons: ComparisonDef[];
};

const DATA_TYPES: { value: DataType; label: string }[] = [
  { value: "TEXT", label: "Text" },
  { value: "NUMBER", label: "Number" },
  { value: "INTEGER", label: "Integer" },
  { value: "BOOLEAN", label: "Boolean" },
  { value: "DATE", label: "Date" },
  { value: "EMAIL", label: "Email" },
];

export default function SchemaEditor({
  initialData,
  allProjects = [],
  allClassifications = [],
}: {
  initialData?: InitialData;
  allProjects?: ProjectRef[];
  allClassifications?: ClassificationRef[];
}) {
  const router = useRouter();
  const classificationTypeById = new Map(allClassifications.map((c) => [c.id, c.type]));

  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [projectIds, setProjectIds] = useState<string[]>(initialData?.projectIds ?? []);
  const [columns, setColumns] = useState<ColumnDef[]>(
    initialData?.columns ?? [{ name: "", dataType: "TEXT", required: true, classificationId: null }]
  );
  const [visualizations, setVisualizations] = useState<VizDef[]>(
    initialData?.visualizations ?? []
  );
  const [comparisons, setComparisons] = useState<ComparisonDef[]>(
    initialData?.comparisons ?? []
  );
  const [addingComparison, setAddingComparison] = useState(false);
  const [pendingComparison, setPendingComparison] = useState<{
    sourceColumnName: string;
    operator: ComparisonOperator;
    targetColumnName: string;
  }>({ sourceColumnName: "", operator: "LT", targetColumnName: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleProject(id: string) {
    setProjectIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  function addColumn() {
    setColumns((prev) => [...prev, { name: "", dataType: "TEXT", required: true, classificationId: null }]);
  }

  function removeColumn(i: number) {
    const removedName = columns[i].name.trim();
    setColumns((prev) => prev.filter((_, idx) => idx !== i));
    if (removedName) {
      setComparisons((prev) =>
        prev.filter(
          (r) => r.sourceColumnName !== removedName && r.targetColumnName !== removedName
        )
      );
    }
  }

  function updateColumn(i: number, updates: Partial<ColumnDef>) {
    const oldCol = columns[i];
    setColumns((prev) =>
      prev.map((col, idx) => (idx === i ? { ...col, ...updates } : col))
    );
    if (updates.dataType !== undefined && oldCol.name.trim()) {
      const oldGroup = getTypeGroup(oldCol.dataType);
      const newGroup = getTypeGroup(updates.dataType);
      if (oldGroup !== newGroup) {
        setComparisons((prev) =>
          prev.filter(
            (r) => r.sourceColumnName !== oldCol.name && r.targetColumnName !== oldCol.name
          )
        );
      }
    }
  }

  const comparableColumns = columns.filter(
    (c) => c.name.trim() && getTypeGroup(c.dataType) !== null
  );

  function eligibleTargets(sourceColumnName: string): ColumnDef[] {
    const srcDef = columns.find((c) => c.name === sourceColumnName);
    if (!srcDef) return [];
    const group = getTypeGroup(srcDef.dataType);
    if (!group) return [];
    return columns.filter(
      (c) => c.name.trim() && c.name !== sourceColumnName && getTypeGroup(c.dataType) === group
    );
  }

  function addComparison() {
    const { sourceColumnName, operator, targetColumnName } = pendingComparison;
    if (!sourceColumnName || !targetColumnName) return;
    const exists = comparisons.some(
      (r) =>
        r.sourceColumnName === sourceColumnName &&
        r.operator === operator &&
        r.targetColumnName === targetColumnName
    );
    if (exists) return;
    setComparisons((prev) => [...prev, { sourceColumnName, operator, targetColumnName }]);
    setPendingComparison({ sourceColumnName: "", operator: "LT", targetColumnName: "" });
    setAddingComparison(false);
  }

  function removeComparison(i: number) {
    setComparisons((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addVisualization() {
    setVisualizations((prev) => [
      ...prev,
      { title: "", type: "INDICATOR", aggregate: "COUNT", valueColumn: "*", xColumn: null, granularity: null },
    ]);
  }

  function removeVisualization(i: number) {
    setVisualizations((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateVisualization(i: number, updates: Partial<VizDef>) {
    setVisualizations((prev) =>
      prev.map((v, idx) => {
        if (idx !== i) return v;
        const next = { ...v, ...updates };
        if (next.aggregate === "COUNT") {
          next.valueColumn = "*";
        } else {
          if (next.valueColumn === "*") next.valueColumn = "";
          if (NUMERIC_AGGREGATES.has(next.aggregate)) {
            const col = columns.find((c) => c.name === next.valueColumn);
            if (!col || !isNumericType(col.dataType)) next.valueColumn = "";
          }
        }
        if (next.type === "INDICATOR") {
          next.xColumn = null;
          next.granularity = null;
        } else {
          const xType = next.xColumn
            ? columns.find((c) => c.name === next.xColumn)?.dataType
            : undefined;
          if (xType === "DATE") {
            if (!next.granularity) next.granularity = "MONTH";
          } else {
            next.granularity = null;
          }
        }
        return next;
      })
    );
  }

  function moveVisualization(i: number, dir: -1 | 1) {
    setVisualizations((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const emptyNames = columns.filter((c) => !c.name.trim());
    if (emptyNames.length > 0) {
      setError("All columns must have a name.");
      return;
    }

    const names = columns.map((c) => c.name.trim());
    if (new Set(names).size !== names.length) {
      setError("Column names must be unique.");
      return;
    }

    for (const v of visualizations) {
      if (!v.title.trim()) {
        setError("Every visualization needs a title.");
        return;
      }
      if (v.aggregate !== "COUNT" && !v.valueColumn) {
        setError(`Visualization "${v.title.trim()}" needs a column.`);
        return;
      }
      if ((v.type === "BAR" || v.type === "LINE") && !v.xColumn) {
        setError(`Visualization "${v.title.trim()}" needs an x-axis column.`);
        return;
      }
    }

    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim(),
        projectIds,
        columns,
        visualizations: visualizations.map((v) => ({
          ...v,
          title: v.title.trim(),
          valueColumn: v.aggregate === "COUNT" ? "*" : v.valueColumn,
        })),
        comparisons: comparisons.map(({ id: _id, ...rest }) => rest),
      };
      const url = initialData ? `/api/schemas/${initialData.id}` : "/api/schemas";
      const method = initialData ? "PUT" : "POST";

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(JSON.stringify(data.error ?? "Save failed"));
      }

      router.push("/admin/schemas");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      {/* Schema name + description */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            File format name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Monthly Sales Report"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        {allProjects.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Projects
            </label>
            <div className="flex flex-wrap gap-2">
              {allProjects.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 cursor-pointer rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={projectIds.includes(p.id)}
                    onChange={() => toggleProject(p.id)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-sm text-gray-700">{p.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Column definitions */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Columns</h2>
          <button
            type="button"
            onClick={addColumn}
            className="text-sm text-brand-600 hover:underline font-medium"
          >
            + Add column
          </button>
        </div>

        <div className="grid grid-cols-12 gap-2 px-6 py-2 text-xs font-medium text-gray-500 border-b border-gray-100">
          <div className="col-span-4">Column name</div>
          <div className="col-span-3">Data type</div>
          <div className="col-span-3">Classification</div>
          <div className="col-span-1 text-center">Nullable</div>
          <div className="col-span-1" />
        </div>

        <div className="divide-y divide-gray-50">
          {columns.map((col, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 px-6 py-3 items-center">
              <div className="col-span-4">
                <input
                  type="text"
                  value={col.name}
                  onChange={(e) => updateColumn(i, { name: e.target.value })}
                  placeholder="column_name"
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div className="col-span-3">
                <select
                  value={col.dataType}
                  onChange={(e) => {
                    const dataType = e.target.value as DataType;
                    const compat = compatibleClassificationTypes(dataType);
                    const currentType = col.classificationId
                      ? classificationTypeById.get(col.classificationId)
                      : undefined;
                    const keep = currentType !== undefined && compat.includes(currentType);
                    updateColumn(i, {
                      dataType,
                      classificationId: keep ? col.classificationId : null,
                    });
                  }}
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {DATA_TYPES.map((dt) => (
                    <option key={dt.value} value={dt.value}>
                      {dt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                {(() => {
                  const compat = compatibleClassificationTypes(col.dataType);
                  const options = allClassifications.filter((c) => compat.includes(c.type));
                  return (
                    <select
                      value={col.classificationId ?? ""}
                      onChange={(e) =>
                        updateColumn(i, { classificationId: e.target.value || null })
                      }
                      disabled={options.length === 0}
                      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
                    >
                      <option value="">{options.length === 0 ? "— N/A —" : "— None —"}</option>
                      {options.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  );
                })()}
              </div>
              <div className="col-span-1 flex justify-center">
                <input
                  type="checkbox"
                  checked={!col.required}
                  onChange={(e) => updateColumn(i, { required: !e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
              </div>
              <div className="col-span-1 flex justify-end">
                {columns.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeColumn(i)}
                    className="text-gray-500 hover:text-red-500 transition-colors"
                    aria-label="Remove column"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-3 bg-gray-50 rounded-b-xl text-xs text-gray-500">
          Non-nullable fields will reject empty or blank values on upload. A classification adds an extra rule — a value list, regex, number range, or date range — and only ones matching the column&apos;s data type can be assigned.
        </div>
      </div>

      {/* Column comparisons */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Column Comparisons</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Optional. Define cross-column rules validated on every uploaded row.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAddingComparison(true)}
            disabled={comparableColumns.length < 2 || addingComparison}
            className="text-sm text-brand-600 hover:underline font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Add comparison
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          {comparisons.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {comparisons.map((rule, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200"
                >
                  <code className="font-mono">{rule.sourceColumnName}</code>
                  <span>{COMPARISON_OPERATOR_LABELS[rule.operator]}</span>
                  <code className="font-mono">{rule.targetColumnName}</code>
                  <button
                    type="button"
                    onClick={() => removeComparison(i)}
                    className="ml-0.5 text-blue-400 hover:text-blue-700 leading-none"
                    aria-label="Remove rule"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {comparisons.length === 0 && !addingComparison && (
            <p className="text-sm text-gray-400">
              {comparableColumns.length < 2
                ? "Add at least two NUMBER, INTEGER, or DATE columns to enable comparison rules."
                : "No comparison rules yet."}
            </p>
          )}

          {addingComparison && (
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={pendingComparison.sourceColumnName}
                onChange={(e) =>
                  setPendingComparison((p) => ({
                    ...p,
                    sourceColumnName: e.target.value,
                    targetColumnName: "",
                  }))
                }
                className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">Source column</option>
                {comparableColumns.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>

              <select
                value={pendingComparison.operator}
                onChange={(e) =>
                  setPendingComparison((p) => ({
                    ...p,
                    operator: e.target.value as ComparisonOperator,
                  }))
                }
                className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {COMPARISON_OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              <select
                value={pendingComparison.targetColumnName}
                onChange={(e) =>
                  setPendingComparison((p) => ({
                    ...p,
                    targetColumnName: e.target.value,
                  }))
                }
                disabled={!pendingComparison.sourceColumnName}
                className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">Target column</option>
                {eligibleTargets(pendingComparison.sourceColumnName).map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>

              <button
                type="button"
                onClick={addComparison}
                disabled={!pendingComparison.sourceColumnName || !pendingComparison.targetColumnName}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddingComparison(false);
                  setPendingComparison({ sourceColumnName: "", operator: "LT", targetColumnName: "" });
                }}
                className="text-xs text-gray-500 hover:underline"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="px-6 py-3 bg-gray-50 rounded-b-xl text-xs text-gray-500">
          Comparison rules apply to each row during upload validation. Only NUMBER, INTEGER, and DATE columns can be compared. Numeric and date columns cannot be mixed in a single rule.
        </div>
      </div>

      {/* Data visualizations */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Data Visualizations</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Optional. Configure indicators and charts uploaders see on their dashboard.
            </p>
          </div>
          <button
            type="button"
            onClick={addVisualization}
            className="text-sm text-brand-600 hover:underline font-medium shrink-0"
          >
            + Add visualization
          </button>
        </div>

        {visualizations.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-500">
            No visualizations yet. Uploaders will see an empty dashboard.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {visualizations.map((v, i) => {
              const namedColumns = columns.filter((c) => c.name.trim());
              const valueOptions = NUMERIC_AGGREGATES.has(v.aggregate)
                ? namedColumns.filter((c) => isNumericType(c.dataType))
                : namedColumns;
              const isChart = v.type === "BAR" || v.type === "LINE";
              const xIsDate =
                isChart && v.xColumn
                  ? columns.find((c) => c.name === v.xColumn)?.dataType === "DATE"
                  : false;
              return (
                <div key={i} className="px-6 py-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={v.title}
                      onChange={(e) => updateVisualization(i, { title: e.target.value })}
                      placeholder="Visualization title"
                      className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveVisualization(i, -1)}
                        disabled={i === 0}
                        className="px-1.5 py-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveVisualization(i, 1)}
                        disabled={i === visualizations.length - 1}
                        className="px-1.5 py-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeVisualization(i)}
                        className="px-1.5 py-1 text-gray-400 hover:text-red-500"
                        aria-label="Remove visualization"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-2">
                    <div className={isChart ? "col-span-3" : "col-span-4"}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                      <select
                        value={v.type}
                        onChange={(e) => updateVisualization(i, { type: e.target.value as VizType })}
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      >
                        {VIZ_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>

                    {isChart && (
                      <div className="col-span-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">X-axis column</label>
                        <select
                          value={v.xColumn ?? ""}
                          onChange={(e) => updateVisualization(i, { xColumn: e.target.value || null })}
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        >
                          <option value="">— Select —</option>
                          {namedColumns.map((c) => (
                            <option key={c.name} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className={isChart ? "col-span-3" : "col-span-4"}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Function</label>
                      <select
                        value={v.aggregate}
                        onChange={(e) => updateVisualization(i, { aggregate: e.target.value as AggregateFn })}
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      >
                        {AGGREGATES.map((a) => (
                          <option key={a.value} value={a.value}>{a.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className={isChart ? "col-span-3" : "col-span-4"}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        {isChart ? "Y-axis column" : "Column"}
                      </label>
                      {v.aggregate === "COUNT" ? (
                        <select
                          value="*"
                          disabled
                          title="Counts all records"
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm bg-gray-50 text-gray-500"
                        >
                          <option value="*">* (all records)</option>
                        </select>
                      ) : (
                        <select
                          value={v.valueColumn}
                          onChange={(e) => updateVisualization(i, { valueColumn: e.target.value })}
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        >
                          <option value="">— Select —</option>
                          {valueOptions.map((c) => (
                            <option key={c.name} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {xIsDate && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-500">Group dates by</span>
                      <select
                        value={v.granularity ?? "MONTH"}
                        onChange={(e) => updateVisualization(i, { granularity: e.target.value as Granularity })}
                        className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      >
                        {GRANULARITIES.map((g) => (
                          <option key={g.value} value={g.value}>{g.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="px-6 py-3 bg-gray-50 rounded-b-xl text-xs text-gray-500">
          Sum, Average, Min, Max, and Median require a numeric column. Charts aggregate the latest valid upload, grouped by the x-axis column.
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : initialData ? "Save changes" : "Create file format"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/schemas")}
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
