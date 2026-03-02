"use client";

import { useEffect, useState } from "react";
import ValidationResults from "./ValidationResults";

type Column = {
  id: string;
  name: string;
  dataType: string;
  required: boolean;
  order: number;
};

type Schema = {
  id: string;
  name: string;
  columns: Column[];
};

type UploadResult = {
  uploadId: string;
  status: string;
  rowCount: number;
  errorCount: number;
  errors: { row: number; column: string; value: string; error: string }[];
};

function emptyRow(columns: Column[]): Record<string, string> {
  return Object.fromEntries(columns.map((c) => [c.name, ""]));
}

function inputType(dataType: string): string {
  switch (dataType) {
    case "NUMBER":
    case "INTEGER":
      return "number";
    case "DATE":
      return "date";
    case "EMAIL":
      return "email";
    default:
      return "text";
  }
}

export default function DataEntryTable({
  schema,
  onSubmitSuccess,
}: {
  schema: Schema;
  onSubmitSuccess?: () => void;
}) {
  const [rows, setRows] = useState<Record<string, string>[]>([
    emptyRow(schema.columns),
  ]);
  const [loadingData, setLoadingData] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load latest upload data whenever the schema changes
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setSubmitError(null);
    setLoadingData(true);

    fetch(`/api/upload/latest-data?schemaId=${schema.id}`)
      .then((r) => r.json())
      .then((data: { rows: Record<string, string>[] }) => {
        if (cancelled) return;
        if (data.rows?.length > 0) {
          setRows(
            data.rows.map((row) =>
              Object.fromEntries(
                schema.columns.map((col) => [col.name, row[col.name] ?? ""])
              )
            )
          );
        } else {
          setRows([emptyRow(schema.columns)]);
        }
      })
      .catch(() => {
        if (!cancelled) setRows([emptyRow(schema.columns)]);
      })
      .finally(() => {
        if (!cancelled) setLoadingData(false);
      });

    return () => {
      cancelled = true;
    };
  }, [schema.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateCell(rowIdx: number, colName: string, value: string) {
    setRows((prev) =>
      prev.map((row, i) => (i === rowIdx ? { ...row, [colName]: value } : row))
    );
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow(schema.columns)]);
  }

  function deleteRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setResult(null);
    setSubmitError(null);

    try {
      const res = await fetch("/api/upload/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaId: schema.id, rows }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data?.error ?? "Submission failed. Please try again.");
        return;
      }

      setResult(data as UploadResult);
      onSubmitSuccess?.();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">
          Manual data entry
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          {loadingData
            ? "Loading latest data…"
            : "Edit rows below and click Submit to save to storage."}
        </p>
      </div>

      {/* Scrollable table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2 w-10 text-left font-medium text-gray-400 text-xs">
                #
              </th>
              {schema.columns.map((col) => (
                <th
                  key={col.id}
                  className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap"
                >
                  <span className="font-mono">{col.name}</span>
                  <span className="ml-1.5 text-gray-400 font-normal text-xs">
                    {col.dataType}
                  </span>
                  {col.required && (
                    <span className="ml-0.5 text-red-400 font-bold text-xs">
                      *
                    </span>
                  )}
                </th>
              ))}
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className="border-b border-gray-100 last:border-0 hover:bg-gray-50/40"
              >
                <td className="px-3 py-1.5 text-xs text-gray-400 select-none">
                  {rowIdx + 1}
                </td>
                {schema.columns.map((col) => (
                  <td key={col.id} className="px-2 py-1">
                    <input
                      type={inputType(col.dataType)}
                      value={row[col.name] ?? ""}
                      onChange={(e) =>
                        updateCell(rowIdx, col.name, e.target.value)
                      }
                      className="w-full min-w-[120px] rounded border border-transparent px-2 py-1 text-sm text-gray-900 placeholder-gray-300 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-transparent hover:bg-white focus:bg-white transition-colors"
                      placeholder="—"
                    />
                  </td>
                ))}
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => deleteRow(rowIdx)}
                    disabled={rows.length === 1}
                    className="p-1 text-gray-300 hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed rounded transition-colors"
                    title="Delete row"
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Row controls + submit */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <PlusIcon />
          Add row
        </button>

        <div className="flex-1" />

        <span className="text-xs text-gray-400">
          {rows.length} {rows.length === 1 ? "row" : "rows"}
        </span>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || rows.length === 0}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Submitting…" : "Submit data"}
        </button>
      </div>

      {submitError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      {result && <ValidationResults result={result} />}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4v16m8-8H4"
      />
    </svg>
  );
}
