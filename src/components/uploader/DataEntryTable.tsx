"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import ValidationResults from "./ValidationResults";
import Spinner from "@/components/Spinner";

const PAGE_SIZE = 50;

type ClassificationType = "VALUE_LIST" | "REGEX" | "NUMBER_RANGE" | "DATE_RANGE";

type Classification = {
  type: ClassificationType;
  description: string | null;
  values: string[];
  caseSensitive: boolean;
  pattern: string | null;
  minNumber: number | null;
  maxNumber: number | null;
  minDate: string | null; // ISO "YYYY-MM-DD"
  maxDate: string | null; // ISO "YYYY-MM-DD"
};

type Column = {
  id: string;
  name: string;
  dataType: string;
  required: boolean;
  order: number;
  classification: Classification | null;
};

type Schema = {
  id: string;
  name: string;
  columns: Column[];
};

type ServerRow = { rowIndex: number; data: Record<string, string> };
type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

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

/**
 * Inline value check for non-value-list classifications (REGEX / NUMBER_RANGE /
 * DATE_RANGE). Value lists are enforced by their dropdown, so they never reach
 * here. This mirrors checkClassification in src/lib/validate.ts to give the user
 * immediate feedback as they type; the server stays the source of truth on submit.
 * Returns an error message or null when the value is acceptable (empty is OK —
 * required/empty is handled by the server on submit).
 */
function classificationError(value: string, col: Column): string | null {
  const c = col.classification;
  if (!c || c.type === "VALUE_LIST") return null;
  const v = value.trim();
  if (v === "") return null;

  switch (c.type) {
    case "REGEX": {
      if (!c.pattern) return null;
      let rx: RegExp;
      try {
        rx = new RegExp(c.pattern, c.caseSensitive === false ? "i" : "");
      } catch {
        return null; // invalid pattern — let the server decide
      }
      if (rx.test(v)) return null;
      const hint = c.description?.trim();
      return hint ? `Does not match the required format. ${hint}` : "Does not match the required format";
    }

    case "NUMBER_RANGE": {
      const n = Number(v);
      if (!Number.isFinite(n)) return "Must be a number";
      const hasMin = c.minNumber !== null && c.minNumber !== undefined;
      const hasMax = c.maxNumber !== null && c.maxNumber !== undefined;
      if (hasMin && hasMax && (n < c.minNumber! || n > c.maxNumber!))
        return `Must be between ${c.minNumber} and ${c.maxNumber}`;
      if (hasMin && !hasMax && n < c.minNumber!) return `Must be at least ${c.minNumber}`;
      if (hasMax && !hasMin && n > c.maxNumber!) return `Must be at most ${c.maxNumber}`;
      return null;
    }

    case "DATE_RANGE": {
      // The date input emits "YYYY-MM-DD", which sorts lexicographically.
      const day = v.slice(0, 10);
      const min = c.minDate ? c.minDate.slice(0, 10) : null;
      const max = c.maxDate ? c.maxDate.slice(0, 10) : null;
      if (min && max && (day < min || day > max)) return `Must be between ${min} and ${max}`;
      if (min && !max && day < min) return `Must be on or after ${min}`;
      if (max && !min && day > max) return `Must be on or before ${max}`;
      return null;
    }

    default:
      return null;
  }
}

/**
 * Apply DATE-column normalisation that the date input expects (YYYY-MM-DD,
 * truncating any ISO time suffix).
 */
function normaliseForInput(row: Record<string, string>, columns: Column[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of columns) {
    let val = String(row[col.name] ?? "");
    if (col.dataType === "DATE" && val.length > 10) val = val.slice(0, 10);
    out[col.name] = val;
  }
  return out;
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
  // Rows for the current page, fresh from the server (read-only baseline).
  const [pageRows, setPageRows] = useState<ServerRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0,
  });

  // Diff tracked across pages — survives pagination/search.
  //   edits:      rowIndex → modified data (overlays the server row when shown)
  //   deletions:  rowIndexes the user has removed (filtered out of display)
  //   newRows:    unsaved additions; shown pinned to the top of page 1
  const [edits, setEdits] = useState<Map<number, Record<string, string>>>(new Map());
  const [deletions, setDeletions] = useState<Set<number>>(new Set());
  const [newRows, setNewRows] = useState<Record<string, string>[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset diff + page when schema/project changes.
  useEffect(() => {
    setEdits(new Map());
    setDeletions(new Set());
    setNewRows([]);
    setSearchQuery("");
    setResult(null);
    setSubmitError(null);
    setPagination((p) => ({ ...p, page: 1, total: 0, totalPages: 0 }));
  }, [schema.id, projectId]);

  // Debounce search input → page reset on query change.
  const debouncedQ = useDebounce(searchQuery, 300);
  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [debouncedQ]);

  // Tracks the most recent fetch. Each call increments the id; only the
  // response whose id matches `requestIdRef.current` at completion time is
  // allowed to update state. This prevents a slow in-flight search
  // ("xyz" matching nothing, scanning many rows) from clobbering the
  // subsequent fast "cleared" fetch that returns the full dataset.
  const requestIdRef = useRef(0);

  // Fetch the current page from the server whenever page or query changes.
  const fetchPage = useCallback(async () => {
    const myId = ++requestIdRef.current;
    setLoadingData(true);
    try {
      const params = new URLSearchParams({
        schemaId: schema.id,
        projectId,
        page: String(pagination.page),
        pageSize: String(PAGE_SIZE),
      });
      if (debouncedQ) params.set("q", debouncedQ);
      const res = await fetch(`/api/upload/latest-data?${params}`);

      if (requestIdRef.current !== myId) return; // a newer fetch is in flight — drop this response

      if (!res.ok) {
        setPageRows([]);
        return;
      }
      const data: { rows: ServerRow[]; pagination: Pagination } = await res.json();

      if (requestIdRef.current !== myId) return; // recheck after the await

      setPageRows(data.rows.map((r) => ({
        rowIndex: r.rowIndex,
        data: normaliseForInput(r.data, schema.columns),
      })));
      setPagination(data.pagination);
    } catch {
      if (requestIdRef.current === myId) setPageRows([]);
    } finally {
      if (requestIdRef.current === myId) setLoadingData(false);
    }
  }, [schema.id, projectId, pagination.page, debouncedQ, schema.columns]);

  useEffect(() => { void fetchPage(); }, [fetchPage]);

  // ── Diff mutators ─────────────────────────────────────────────────────────

  function editServerRow(rowIndex: number, colName: string, value: string) {
    setEdits((prev) => {
      const next = new Map(prev);
      const baseline = pageRows.find((r) => r.rowIndex === rowIndex)?.data ?? {};
      const current = next.get(rowIndex) ?? baseline;
      next.set(rowIndex, { ...current, [colName]: value });
      return next;
    });
  }

  function editNewRow(newRowIdx: number, colName: string, value: string) {
    setNewRows((prev) => prev.map((r, i) => (i === newRowIdx ? { ...r, [colName]: value } : r)));
  }

  function addRow() {
    setNewRows((prev) => [emptyRow(schema.columns), ...prev]);
    setPagination((p) => ({ ...p, page: 1 }));
  }

  function deleteServerRow(rowIndex: number) {
    setDeletions((prev) => {
      const next = new Set(prev);
      next.add(rowIndex);
      return next;
    });
    setEdits((prev) => {
      if (!prev.has(rowIndex)) return prev;
      const next = new Map(prev);
      next.delete(rowIndex);
      return next;
    });
  }

  function deleteNewRow(newRowIdx: number) {
    setNewRows((prev) => prev.filter((_, i) => i !== newRowIdx));
  }

  function clearAllPending() {
    setEdits(new Map());
    setDeletions(new Set());
    setNewRows([]);
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setSubmitting(true);
    setResult(null);
    setSubmitError(null);

    const payload = {
      schemaId: schema.id,
      projectId,
      edits: Array.from(edits.entries()).map(([rowIndex, data]) => ({ rowIndex, data })),
      additions: newRows.map((data) => ({ data })),
      deletions: Array.from(deletions),
    };

    try {
      const res = await apiFetch("/api/upload/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(typeof data?.error === "string" ? data.error : "Submission failed. Please try again.");
        return;
      }
      setResult(data as UploadResult);
      if ((data as UploadResult).status === "VALID") {
        clearAllPending();
        setPagination((p) => ({ ...p, page: 1 }));
        void fetchPage();
        onSubmitSuccess?.();
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Derived view: pinned new rows + visible server rows (edits & deletions applied) ──

  const visibleServerRows = pageRows
    .filter((r) => !deletions.has(r.rowIndex))
    .map((r) => ({ ...r, data: edits.get(r.rowIndex) ?? r.data }));

  const pinnedNewRows = pagination.page === 1 ? newRows : [];

  const pendingCount = edits.size + deletions.size + newRows.length;
  const totalAfterDiff = Math.max(0, pagination.total + newRows.length - deletions.size);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold text-gray-900">Manual data entry</h2>
          <p className="text-xs text-gray-500 mt-0.5 inline-flex items-center gap-1.5">
            {loadingData && <Spinner size="xs" label="Loading data" />}
            {loadingData
              ? "Loading…"
              : pendingCount > 0
                ? `${pendingCount} pending change${pendingCount === 1 ? "" : "s"}. Click Submit to apply to the dataset.`
                : "Edit rows below and click Submit to save changes to the dataset."}
          </p>
        </div>
        {/* Search */}
        <div className="relative w-56 shrink-0">
          <SearchIcon />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search all rows…"
            aria-label="Search rows"
            // [&::-webkit-search-cancel-button] hides the native clear (X) so it
            // doesn't overlap our custom one. Keeps type="search" semantics for
            // screen readers and mobile keyboards.
            className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 [&::-webkit-search-cancel-button]:hidden"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
            >
              <ClearIcon />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={addRow}
          className="shrink-0 flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <PlusIcon />
          Add row
        </button>
      </div>

      {/* Scrollable table — dimmed while fetching so users see the load is in progress */}
      <div
        className={`relative overflow-x-auto overflow-y-auto max-h-[60vh] rounded-lg border border-gray-200 transition-opacity ${
          loadingData && (pinnedNewRows.length > 0 || visibleServerRows.length > 0)
            ? "opacity-60"
            : ""
        }`}
        aria-busy={loadingData}
      >
        {loadingData && (pinnedNewRows.length > 0 || visibleServerRows.length > 0) && (
          <div className="absolute top-2 right-2 z-20 rounded-full bg-white/80 backdrop-blur-sm px-2 py-1 shadow-sm">
            <Spinner size="xs" label="Loading data" />
          </div>
        )}
        <table className="min-w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2 w-10 text-left font-medium text-gray-600 text-xs">#</th>
              {schema.columns.map((col) => (
                <th
                  key={col.id}
                  className="px-3 py-2 text-left font-medium text-gray-700 whitespace-nowrap"
                >
                  <span className="font-mono">{col.name}</span>
                  <span className="ml-1.5 text-gray-600 font-normal text-xs">{col.dataType}</span>
                  {col.required && (
                    <span className="ml-0.5 text-red-600 font-bold text-xs" aria-label="required">*</span>
                  )}
                </th>
              ))}
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {pinnedNewRows.length === 0 && visibleServerRows.length === 0 ? (
              <tr>
                <td colSpan={schema.columns.length + 2} className="px-3 py-10 text-center text-sm text-gray-600">
                  {loadingData ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner size="md" label="Loading data" />
                      <span>Loading…</span>
                    </span>
                  ) : (
                    debouncedQ ? "No matching rows." : "No data. Click Add row to start entering."
                  )}
                </td>
              </tr>
            ) : (
              <>
                {pinnedNewRows.map((row, i) => (
                  <Row
                    key={`new-${i}`}
                    columns={schema.columns}
                    data={row}
                    onChange={(col, v) => editNewRow(i, col, v)}
                    onDelete={() => deleteNewRow(i)}
                    rowKey={i + 1}
                    label="new"
                  />
                ))}
                {visibleServerRows.map((r) => (
                  <Row
                    key={`row-${r.rowIndex}`}
                    columns={schema.columns}
                    data={r.data}
                    onChange={(col, v) => editServerRow(r.rowIndex, col, v)}
                    onDelete={() => deleteServerRow(r.rowIndex)}
                    rowKey={r.rowIndex}
                    edited={edits.has(r.rowIndex)}
                  />
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination + submit */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1" />
        {pagination.totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPagination((p) => ({ ...p, page: Math.max(1, p.page - 1) }))}
              disabled={pagination.page === 1 || loadingData}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ‹ Prev
            </button>
            <span className="text-xs text-gray-500 px-1">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPagination((p) => ({ ...p, page: Math.min(p.totalPages, p.page + 1) }))}
              disabled={pagination.page >= pagination.totalPages || loadingData}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next ›
            </button>
          </div>
        )}
        <span className="text-xs text-gray-500">
          {totalAfterDiff} {totalAfterDiff === 1 ? "row" : "rows"} total
          {debouncedQ ? ` (${pagination.total} match search)` : ""}
        </span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || pendingCount === 0}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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

// ── Row component ───────────────────────────────────────────────────────────

function Row({
  columns,
  data,
  onChange,
  onDelete,
  rowKey,
  edited,
  label,
}: {
  columns: Column[];
  data: Record<string, string>;
  onChange: (col: string, value: string) => void;
  onDelete: () => void;
  rowKey: number;
  edited?: boolean;
  label?: "new";
}) {
  return (
    <tr
      className={`border-b border-gray-100 last:border-0 hover:bg-gray-50/40 ${
        label === "new" ? "bg-green-50/40" : edited ? "bg-yellow-50/40" : ""
      }`}
    >
      <td className="px-3 py-1.5 text-xs text-gray-600 select-none">
        {label === "new" ? "+" : rowKey}
      </td>
      {columns.map((col) => {
        const value = data[col.name] ?? "";
        // Only value-list classifications constrain entry to a dropdown; other
        // classification types use a normal input and are checked on the fly.
        const isValueList = col.classification?.type === "VALUE_LIST";
        const error = classificationError(value, col);
        return (
          <td key={col.id} className="px-2 py-1 align-top">
            {isValueList ? (
              <select
                value={value}
                onChange={(e) => onChange(col.name, e.target.value)}
                aria-label={`${col.name}, row ${rowKey}`}
                className="w-full min-w-[120px] rounded border border-transparent px-2 py-1 text-sm text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 bg-transparent hover:bg-white focus:bg-white transition-colors"
              >
                <option value="">—</option>
                {col.classification!.values.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            ) : (
              <>
                <input
                  type={inputType(col.dataType)}
                  value={value}
                  onChange={(e) => onChange(col.name, e.target.value)}
                  aria-label={`${col.name}, row ${rowKey}`}
                  aria-invalid={error ? true : undefined}
                  title={error ?? undefined}
                  className={`w-full min-w-[120px] rounded border px-2 py-1 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-1 transition-colors ${
                    error
                      ? "border-red-300 focus:border-red-400 focus:ring-red-400 bg-red-50/40"
                      : "border-transparent focus:border-brand-400 focus:ring-brand-400 bg-transparent hover:bg-white focus:bg-white"
                  }`}
                  placeholder="—"
                />
                {error && (
                  <p className="mt-0.5 text-xs text-red-600 max-w-[220px] whitespace-normal">{error}</p>
                )}
              </>
            )}
          </td>
        );
      })}
      <td className="px-2 py-1.5">
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete row"
          className="p-1 text-gray-500 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
          title="Delete row"
        >
          <TrashIcon />
        </button>
      </td>
    </tr>
  );
}

// ── useDebounce ─────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), delay);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, delay]);
  return debounced;
}

// ── Icons ───────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg
      className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none"
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
