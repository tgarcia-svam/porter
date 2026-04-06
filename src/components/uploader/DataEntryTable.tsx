"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import ValidationResults from "./ValidationResults";

const PAGE_SIZE = 25;

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
  errorsCapped: boolean;
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
  projectId,
  onSubmitSuccess,
}: {
  schema: Schema;
  projectId: string;
  onSubmitSuccess?: () => void;
}) {
  const [rows, setRows] = useState<Record<string, string>[]>([
    emptyRow(schema.columns),
  ]);
  const [loadingData, setLoadingData] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(0);

  // Load latest upload data whenever the schema or project changes
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setSubmitError(null);
    setSearchQuery("");
    setCurrentPage(0);
    setLoadingData(true);

    fetch(`/api/upload/latest-data?schemaId=${schema.id}&projectId=${projectId}`)
      .then((r) => r.json())
      .then((data: { rows: Record<string, string>[] }) => {
        if (cancelled) return;
        if (data.rows?.length > 0) {
          setRows(
            data.rows.map((row) =>
              Object.fromEntries(
                schema.columns.map((col) => {
                  let val = String(row[col.name] ?? "");
                  // ISO datetime strings must be truncated to YYYY-MM-DD for <input type="date">
                  if (col.dataType === "DATE" && val.length > 10) val = val.slice(0, 10);
                  return [col.name, val];
                })
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
  }, [schema.id, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateCell(originalIdx: number, colName: string, value: string) {
    setRows((prev) =>
      prev.map((row, i) => (i === originalIdx ? { ...row, [colName]: value } : row))
    );
  }

  function addRow() {
    setRows((prev) => [emptyRow(schema.columns), ...prev]);
    setSearchQuery("");
    setCurrentPage(0);
  }

  function deleteRow(originalIdx: number) {
    setRows((prev) => prev.filter((_, i) => i !== originalIdx));
    // If deleting the last item on the current page, step back one page
    setCurrentPage((p) => {
      const newTotal = rows.length - 1;
      const maxPage = Math.max(0, Math.ceil(newTotal / PAGE_SIZE) - 1);
      return Math.min(p, maxPage);
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    setResult(null);
    setSubmitError(null);

    try {
      const res = await apiFetch("/api/upload/manual", {
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

  // Compute filtered rows (preserving original indices for edit/delete)
  const q = searchQuery.trim().toLowerCase();
  const filteredRows = rows
    .map((row, originalIdx) => ({ row, originalIdx }))
    .filter(({ row }) => {
      if (!q) return true;
      return schema.columns.some((col) => {
        const val = String(row[col.name] ?? "");
        if (col.dataType === "DATE" && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
          const [y, m, d] = val.split("-");
          if (`${m}/${d}/${y}`.includes(q)) return true;
        }
        return val.toLowerCase().includes(q);
      });
    });

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages - 1);
  const pageRows = filteredRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function handleSearch(value: string) {
    setSearchQuery(value);
    setCurrentPage(0);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold text-gray-900">Manual data entry</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {loadingData
              ? "Loading latest data…"
              : "Edit rows below and click Submit to save to storage."}
          </p>
        </div>
        {/* Search */}
        <div className="relative w-56 shrink-0">
          <SearchIcon />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search all columns…"
            className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <ClearIcon />
            </button>
          )}
        </div>
        {/* Add row — top */}
        <button
          type="button"
          onClick={addRow}
          className="shrink-0 flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <PlusIcon />
          Add row
        </button>
      </div>

      {/* Search result count */}
      {q && (
        <p className="text-xs text-gray-500">
          {filteredRows.length === 0
            ? "No rows match your search."
            : `${filteredRows.length} of ${rows.length} rows match`}
        </p>
      )}

      {/* Scrollable table */}
      <div className="overflow-x-auto overflow-y-auto max-h-[60vh] rounded-lg border border-gray-200">
        <table className="min-w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2 w-10 text-left font-medium text-gray-400 text-xs">#</th>
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
                    <span className="ml-0.5 text-red-400 font-bold text-xs">*</span>
                  )}
                </th>
              ))}
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={schema.columns.length + 2}
                  className="px-3 py-6 text-center text-sm text-gray-400"
                >
                  {q ? "No matching rows." : "No data."}
                </td>
              </tr>
            ) : (
              pageRows.map(({ row, originalIdx }) => (
                <tr
                  key={originalIdx}
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50/40"
                >
                  <td className="px-3 py-1.5 text-xs text-gray-400 select-none">
                    {originalIdx + 1}
                  </td>
                  {schema.columns.map((col) => (
                    <td key={col.id} className="px-2 py-1">
                      <input
                        type={inputType(col.dataType)}
                        value={row[col.name] ?? ""}
                        onChange={(e) => updateCell(originalIdx, col.name, e.target.value)}
                        className="w-full min-w-[120px] rounded border border-transparent px-2 py-1 text-sm text-gray-900 placeholder-gray-300 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-transparent hover:bg-white focus:bg-white transition-colors"
                        placeholder="—"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => deleteRow(originalIdx)}
                      disabled={rows.length === 1}
                      className="p-1 text-gray-300 hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed rounded transition-colors"
                      title="Delete row"
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination + submit */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1" />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ‹ Prev
            </button>
            <span className="text-xs text-gray-500 px-1">
              Page {safePage + 1} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage === totalPages - 1}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next ›
            </button>
          </div>
        )}

        <span className="text-xs text-gray-400">
          {rows.length} {rows.length === 1 ? "row" : "rows"} total
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

function SearchIcon() {
  return (
    <svg
      className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
      />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
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
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}
