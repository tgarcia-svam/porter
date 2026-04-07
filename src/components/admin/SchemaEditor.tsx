"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

type DataType = "TEXT" | "NUMBER" | "INTEGER" | "BOOLEAN" | "DATE" | "EMAIL";

type ColumnDef = {
  name: string;
  dataType: DataType;
  required: boolean;
  classificationId: string | null;
};

type ProjectRef = { id: string; name: string };
type ClassificationRef = { id: string; name: string };

type Granularity = "DAY" | "MONTH" | "YEAR";

type InitialData = {
  id: string;
  name: string;
  description: string;
  projectIds: string[];
  columns: ColumnDef[];
  timeSeriesColumn: string | null;
  timeSeriesGranularity: Granularity | null;
};

const DATA_TYPES: { value: DataType; label: string; description: string }[] = [
  { value: "TEXT", label: "Text", description: "Any string value" },
  { value: "NUMBER", label: "Number", description: "Numeric value (decimals OK)" },
  { value: "INTEGER", label: "Integer", description: "Whole numbers only" },
  { value: "BOOLEAN", label: "Boolean", description: "true/false, yes/no, 1/0" },
  { value: "DATE", label: "Date", description: "Any parseable date" },
  { value: "EMAIL", label: "Email", description: "Valid email address" },
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
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [projectIds, setProjectIds] = useState<string[]>(initialData?.projectIds ?? []);

  function toggleProject(id: string) {
    setProjectIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }
  const [columns, setColumns] = useState<ColumnDef[]>(
    initialData?.columns ?? [{ name: "", dataType: "TEXT", required: true, classificationId: null }]
  );
  const [timeSeriesColumn, setTimeSeriesColumn] = useState<string>(
    initialData?.timeSeriesColumn ?? ""
  );
  const [timeSeriesGranularity, setTimeSeriesGranularity] = useState<Granularity>(
    initialData?.timeSeriesGranularity ?? "MONTH"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addColumn() {
    setColumns((prev) => [...prev, { name: "", dataType: "TEXT", required: true, classificationId: null }]);
  }

  function removeColumn(i: number) {
    setColumns((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateColumn(i: number, updates: Partial<ColumnDef>) {
    setColumns((prev) =>
      prev.map((col, idx) => (idx === i ? { ...col, ...updates } : col))
    );
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

    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim(),
        projectIds,
        columns,
        timeSeriesColumn: timeSeriesColumn || null,
        timeSeriesGranularity: timeSeriesColumn ? timeSeriesGranularity : null,
      };
      const url = initialData
        ? `/api/schemas/${initialData.id}`
        : "/api/schemas";
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
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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
            className="text-sm text-blue-600 hover:underline font-medium"
          >
            + Add column
          </button>
        </div>

        {/* Header row */}
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
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-3">
                <select
                  value={col.dataType}
                  onChange={(e) =>
                    updateColumn(i, { dataType: e.target.value as DataType })
                  }
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {DATA_TYPES.map((dt) => (
                    <option key={dt.value} value={dt.value}>
                      {dt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <select
                  value={col.classificationId ?? ""}
                  onChange={(e) =>
                    updateColumn(i, { classificationId: e.target.value || null })
                  }
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— None —</option>
                  {allClassifications.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-1 flex justify-center">
                <input
                  type="checkbox"
                  checked={!col.required}
                  onChange={(e) => updateColumn(i, { required: !e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-1 flex justify-end">
                {columns.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeColumn(i)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
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

        <div className="px-6 py-3 bg-gray-50 rounded-b-xl text-xs text-gray-400">
          Non-nullable fields will reject empty or blank values on upload. A classification restricts the column to a predefined list of values.
        </div>
      </div>

      {/* Time series configuration */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Statistics</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Optional. Configure a date column to show a time series chart to uploaders.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Date column for time series
          </label>
          <select
            value={timeSeriesColumn}
            onChange={(e) => setTimeSeriesColumn(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— None —</option>
            {columns
              .filter((c) => c.dataType === "DATE" && c.name.trim())
              .map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        {timeSeriesColumn && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Group by
            </label>
            <div className="flex gap-3">
              {(["DAY", "MONTH", "YEAR"] as Granularity[]).map((g) => (
                <label key={g} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="granularity"
                    value={g}
                    checked={timeSeriesGranularity === g}
                    onChange={() => setTimeSeriesGranularity(g)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 capitalize">{g.toLowerCase()}</span>
                </label>
              ))}
            </div>
          </div>
        )}
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
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
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
