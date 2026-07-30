"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";
import ValidationResults from "./ValidationResults";
import DataEntryTable from "./DataEntryTable";
import DashboardPanel from "./DashboardPanel";

type ClassificationType = "VALUE_LIST" | "REGEX" | "NUMBER_RANGE" | "DATE_RANGE";

type Classification = {
  type: ClassificationType;
  description: string | null;
  values: string[];
  caseSensitive: boolean;
  pattern: string | null;
  minNumber: number | null;
  maxNumber: number | null;
  minDate: string | null;
  maxDate: string | null;
};

type Column = {
  id: string;
  name: string;
  dataType: string;
  required: boolean;
  order: number;
  classification: Classification | null;
};

type ComparisonOperator = "LT" | "LTE" | "GT" | "GTE";

type Comparison = {
  sourceColumnName: string;
  operator: ComparisonOperator;
  targetColumnName: string;
};

const COMPARISON_OPERATOR_LABELS: Record<ComparisonOperator, string> = {
  LT: "<", LTE: "≤", GT: ">", GTE: "≥",
};

type Schema = {
  id: string;
  name: string;
  description: string | null;
  columns: Column[];
  comparisons: Comparison[];
};

type Schedule = {
  frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  weekday: number | null;
  dayOfMonth: number | null;
  monthOfQuarter: number | null;
  monthOfYear: number | null;
};

type Project = {
  id: string;
  name: string;
  schedule: Schedule | null;
  schemas: Schema[];
};

const WEEKDAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const QUARTER_MONTHS = ["first","second","third"];

function ordinal(n: number) {
  const v = n % 100;
  return n + (["th","st","nd","rd"][(v - 20) % 10] ?? ["th","st","nd","rd"][v] ?? "th");
}

function formatSchedule(s: Schedule): string {
  switch (s.frequency) {
    case "WEEKLY":
      return s.weekday != null ? `Every ${WEEKDAYS[s.weekday]}` : "Weekly";
    case "MONTHLY":
      return s.dayOfMonth != null ? `Monthly on the ${ordinal(s.dayOfMonth)}` : "Monthly";
    case "QUARTERLY": {
      const m = s.monthOfQuarter != null ? QUARTER_MONTHS[s.monthOfQuarter - 1] : null;
      const d = s.dayOfMonth != null ? ordinal(s.dayOfMonth) : null;
      return m && d ? `Quarterly — ${d} of the ${m} month` : "Quarterly";
    }
    case "YEARLY": {
      const m = s.monthOfYear != null ? MONTHS[s.monthOfYear - 1] : null;
      const d = s.dayOfMonth != null ? ordinal(s.dayOfMonth) : null;
      return m && d ? `Annually on ${m} ${d}` : "Annually";
    }
  }
}

type UploadRecord = {
  id: string;
  fileName: string;
  schemaName: string;
  status: string;
  errorCount: number;
  createdAt: string;
  blobUrl: string | null;
  uploadedBy: string;
};

type ValidationError = {
  row: number;
  column: string;
  value: string;
  error: string;
};

type UploadResult = {
  uploadId: string;
  status: string;
  rowCount: number;
  errorCount: number;
  errorsCapped: boolean;
  errors: ValidationError[];
};

function DownloadIcon() {
  return (
    <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

export default function FileUploader({
  projects,
  initialUploads,
  directUpload = false,
}: {
  projects: Project[];
  initialUploads: UploadRecord[];
  directUpload?: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize from the first available item so SSR and initial client render
  // match, then restore any localStorage preference after hydration.
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? "");
  const [selectedSchemaId, setSelectedSchemaId] = useState(
    projects[0]?.schemas[0]?.id ?? ""
  );

  useEffect(() => {
    const savedProject = localStorage.getItem("porter:projectId");
    const savedSchema = localStorage.getItem("porter:schemaId");
    if (savedProject && projects.some((p) => p.id === savedProject)) {
      setSelectedProjectId(savedProject);
      const schemas = projects.find((p) => p.id === savedProject)?.schemas ?? [];
      if (savedSchema && schemas.some((s) => s.id === savedSchema)) {
        setSelectedSchemaId(savedSchema);
      } else {
        setSelectedSchemaId(schemas[0]?.id ?? "");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [activeTab, setActiveTab] = useState<"upload" | "entry" | "dashboard" | "files">("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>(initialUploads);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const availableSchemas = selectedProject?.schemas ?? [];
  const selectedSchema = availableSchemas.find((s) => s.id === selectedSchemaId);

  function clearFileState() {
    setSelectedFile(null);
    setSheetNames([]);
    setSelectedSheet("");
    setResult(null);
    setUploadError(null);
  }

  function handleTabChange(tab: "upload" | "entry" | "dashboard" | "files") {
    setActiveTab(tab);
    if (tab !== "dashboard") clearFileState();
  }

  function handleProjectChange(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    const schemaId = project?.schemas[0]?.id ?? "";
    setSelectedProjectId(projectId);
    setSelectedSchemaId(schemaId);
    localStorage.setItem("porter:projectId", projectId);
    localStorage.setItem("porter:schemaId", schemaId);
    clearFileState();
  }

  async function handleExportExcel() {
    if (!selectedSchema) return;
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(selectedSchema.name);

    ws.columns = selectedSchema.columns.map((col) => ({
      header: col.name,
      key: col.name,
      width: Math.max(col.name.length + 4, 14),
    }));

    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FF1E3A5F" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FF93C5FD" } },
      };
      cell.alignment = { vertical: "middle" };
    });

    const buf = await wb.xlsx.writeBuffer();
    const slug = selectedSchema.name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const url = URL.createObjectURL(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}_template.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportSql() {
    if (!selectedSchema) return;
    const SQL_TYPES: Record<string, string> = {
      TEXT: "TEXT",
      NUMBER: "NUMERIC",
      INTEGER: "INTEGER",
      BOOLEAN: "BOOLEAN",
      DATE: "DATE",
      EMAIL: "VARCHAR(255)",
    };
    const toSnake = (s: string) =>
      s.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

    const table = toSnake(selectedSchema.name);
    const cols = [...selectedSchema.columns]
      .sort((a, b) => a.order - b.order)
      .map((col) => {
        const type = SQL_TYPES[col.dataType] ?? "TEXT";
        return `  ${toSnake(col.name)} ${type}${col.required ? " NOT NULL" : ""}`;
      });
    const ddl = `CREATE TABLE ${table} (\n${cols.join(",\n")}\n);\n`;

    const url = URL.createObjectURL(new Blob([ddl], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table}_ddl.sql`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFileSelect(file: File) {
    if (file.size > 100 * 1024 * 1024) {
      alert("File exceeds the 100 MB size limit.");
      return;
    }

    const allowed = [
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!allowed.includes(file.type) && ext !== "csv" && ext !== "xlsx" && ext !== "xls") {
      alert("Only CSV and Excel files are supported.");
      return;
    }
    setResult(null);
    setUploadError(null);

    const isExcel = ext === "xlsx" || ext === "xls";
    if (isExcel) {
      const arrayBuffer = await file.arrayBuffer();
      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(arrayBuffer);
      const names = workbook.worksheets.map((ws) => ws.name);
      setSheetNames(names);
      setSelectedSheet(names[0] ?? "");
    } else {
      setSheetNames([]);
      setSelectedSheet("");
    }

    setSelectedFile(file);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, []);

  async function refreshHistory() {
    const historyRes = await fetch("/api/upload");
    if (historyRes.ok) {
      const history = await historyRes.json();
      setUploads(
        history.map((u: {
          id: string;
          fileName: string;
          schema: { name: string };
          status: string;
          errorCount: number;
          createdAt: string;
          blobUrl: string | null;
          user?: { name: string | null; email: string };
        }) => ({
          id: u.id,
          fileName: u.fileName,
          schemaName: u.schema.name,
          status: u.status,
          errorCount: u.errorCount,
          createdAt: u.createdAt,
          blobUrl: u.blobUrl,
          uploadedBy: u.user?.name ?? u.user?.email ?? "Unknown",
        }))
      );
    }
    router.refresh();
  }

  function stopPolling() {
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  useEffect(() => {
    return () => stopPolling();
  }, []);

  async function handleUpload() {
    if (!selectedFile || !selectedSchemaId) return;
    setUploading(true);
    setResult(null);
    setUploadError(null);

    let isAsyncPath = false;

    try {
      let data: UploadResult & { status: string; uploadId?: string };

      if (directUpload) {
        // ── Direct-to-blob path (production) ──────────────────────────────────
        // Step 1 — get a SAS URL
        const sasRes = await apiFetch("/api/upload/sas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schemaId: selectedSchemaId,
            projectId: selectedProjectId,
            fileName: selectedFile.name,
            mimeType: selectedFile.type || "application/octet-stream",
          }),
        });
        let sasData: { sasUrl?: string; blobName?: string; error?: string } = {};
        try { sasData = await sasRes.json(); } catch { /* non-JSON error body */ }
        if (!sasRes.ok) {
          setUploadError(sasData?.error ?? `Upload initialisation failed (HTTP ${sasRes.status}). Please try again.`);
          return;
        }
        const { sasUrl, blobName } = sasData as { sasUrl: string; blobName: string };

        // Step 2 — PUT directly to blob storage
        console.log("[upload] PUT to blob storage, sasUrl prefix:", sasUrl.slice(0, 80));
        let putRes: Response;
        try {
          putRes = await fetch(sasUrl, {
            method: "PUT",
            headers: {
              "Content-Type": selectedFile.type || "application/octet-stream",
              "x-ms-blob-type": "BlockBlob",
            },
            body: selectedFile,
          });
        } catch (putErr) {
          // Network error — almost always CORS blocking the preflight
          console.error("[upload] PUT network error (likely CORS):", putErr);
          setUploadError(`File could not be sent to storage (network error — check browser console for CORS details).`);
          return;
        }
        console.log("[upload] PUT response status:", putRes.status);
        if (!putRes.ok) {
          const body = await putRes.text().catch(() => "");
          console.error("[upload] PUT failed:", putRes.status, body);
          setUploadError(`File upload to storage failed (HTTP ${putRes.status}). Please try again.`);
          return;
        }
        console.log("[upload] PUT succeeded, calling confirm...");

        // Step 3 — confirm: create record + enqueue job
        const confirmRes = await apiFetch("/api/upload/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blobName,
            schemaId: selectedSchemaId,
            projectId: selectedProjectId,
            fileName: selectedFile.name,
            mimeType: selectedFile.type || "application/octet-stream",
            sheetName: selectedSheet || undefined,
          }),
        });
        let confirmData: Record<string, unknown> = {};
        try { confirmData = await confirmRes.json(); } catch { /* non-JSON error body */ }
        if (!confirmRes.ok) {
          setUploadError((confirmData?.error as string) ?? "An unexpected error occurred. Please try again.");
          return;
        }
        data = confirmData as typeof data;
      } else {
        // ── Server-side multipart path (local dev) ─────────────────────────────
        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("schemaId", selectedSchemaId);
        formData.append("projectId", selectedProjectId);
        if (selectedSheet) formData.append("sheetName", selectedSheet);

        const res = await apiFetch("/api/upload", { method: "POST", body: formData });
        let resData: Record<string, unknown> = {};
        try { resData = await res.json(); } catch { /* non-JSON error body (e.g. 403 text) */ }
        if (!res.ok) {
          setUploadError((resData?.error as string) ?? `An unexpected error occurred (HTTP ${res.status}). Please try again.`);
          return;
        }
        data = resData as typeof data;
      }

      if (data.status === "PENDING") {
        isAsyncPath = true;
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";

        const uploadId = data.uploadId!;
        pollingRef.current = setInterval(async () => {
          try {
            const pollRes = await fetch(`/api/upload/${uploadId}/status`);
            if (!pollRes.ok) return;
            const pollData = await pollRes.json();
            if (pollData.status !== "PENDING") {
              stopPolling();
              setUploading(false);
              setResult(pollData as UploadResult);
              await refreshHistory();
            }
          } catch {
            // network hiccup — keep polling
          }
        }, 3_000);
        return;
      }

      setResult(data as UploadResult);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshHistory();
    } catch (err) {
      // Never fail silently — surface something the user can act on.
      console.error("[upload] unexpected error:", err);
      setUploadError("An unexpected error occurred. Please try again.");
    } finally {
      if (!isAsyncPath) setUploading(false);
    }
  }

  if (projects.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
        <p className="text-gray-500 text-sm font-medium">No projects available</p>
        <p className="mt-1 text-gray-500 text-sm">
          An administrator needs to assign your organization to a project with
          schemas before you can upload files.
        </p>
      </div>
    );
  }

  const tabs: { key: "upload" | "entry" | "dashboard" | "files"; label: string }[] = [
    { key: "upload",    label: "File Upload" },
    { key: "entry",     label: "Manual Entry" },
    { key: "dashboard", label: "Dashboard" },
    { key: "files",     label: "Files" },
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">

      {/* ── Left sidebar: project + schema selectors ── */}
      <div className="w-full lg:w-56 shrink-0 bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <div>
          <label htmlFor="upload-project-select" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            Project
          </label>
          <select
            id="upload-project-select"
            value={selectedProjectId}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="upload-schema-select" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            File Format
          </label>
          <select
            id="upload-schema-select"
            value={selectedSchemaId}
            onChange={(e) => {
                setSelectedSchemaId(e.target.value);
                localStorage.setItem("porter:schemaId", e.target.value);
                clearFileState();
              }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {availableSchemas.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {selectedSchema?.description && (
            <p className="mt-1.5 text-xs text-gray-500 leading-snug">{selectedSchema.description}</p>
          )}
        </div>

        {selectedProject?.schedule && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Upload Frequency
            </p>
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
              <p className="text-xs font-medium text-blue-800">
                {formatSchedule(selectedProject.schedule)}
              </p>
            </div>
          </div>
        )}

      </div>

      {/* ── Main panel ── */}
      <div className="flex-1 min-w-0 space-y-5">

        {/* Tab bar */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex gap-1">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === key
                    ? "border-brand-600 text-brand-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* File Upload tab */}
        {activeTab === "upload" && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              {selectedSchema && selectedSchema.columns.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Expected Data Format
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleExportExcel}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors"
                      >
                        <DownloadIcon />
                        Excel Template
                      </button>
                      <button
                        type="button"
                        onClick={handleExportSql}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors"
                      >
                        <DownloadIcon />
                        SQL DDL
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-gray-200 inline-block max-w-full">
                    <table className="text-xs w-auto">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="px-2 py-1.5 text-left font-semibold text-gray-500 whitespace-nowrap border-r border-gray-200">
                            Headers
                          </th>
                          {selectedSchema.columns.map((col) => (
                            <th
                              key={col.id}
                              className="px-2 py-1.5 text-left font-semibold text-gray-700 font-mono whitespace-nowrap"
                            >
                              {col.name}
                              {col.required && (
                                <span className="ml-0.5 text-red-500">*</span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-gray-100">
                          <td className="px-2 py-1.5 text-gray-500 font-medium whitespace-nowrap border-r border-gray-200">
                            Data Type
                          </td>
                          {selectedSchema.columns.map((col) => (
                            <td key={col.id} className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                              {col.dataType}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="px-2 py-1.5 text-gray-500 font-medium whitespace-nowrap border-r border-gray-200">
                            Value Requirements
                          </td>
                          {selectedSchema.columns.map((col) => (
                            <td key={col.id} className="px-2 py-1.5 align-top">
                              {col.classification ? (
                                <ValueRequirements c={col.classification} />
                              ) : (
                                <span aria-hidden="true" className="text-gray-500">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1.5 text-xs text-gray-500">
                    <span className="text-red-500 font-bold">*</span> required
                  </p>
                  {selectedSchema.comparisons.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                        Cross-column Rules
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedSchema.comparisons.map((r, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200"
                          >
                            <code className="font-mono">{r.sourceColumnName}</code>
                            <span>{COMPARISON_OPERATOR_LABELS[r.operator]}</span>
                            <code className="font-mono">{r.targetColumnName}</code>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  dragging ? "border-brand-400 bg-brand-50"
                  : selectedFile ? "border-green-400 bg-green-50"
                  : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                />
                {selectedFile ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-center gap-2">
                      <FileIcon />
                      <span className="text-sm font-medium text-gray-900">{selectedFile.name}</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {(selectedFile.size / 1024).toFixed(1)} KB — click to change
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <UploadIcon />
                    <p className="text-sm font-medium text-gray-600">Drop a CSV or Excel file here</p>
                    <p className="text-xs text-gray-500">or click to browse</p>
                  </div>
                )}
              </div>

              {sheetNames.length > 0 && (
                <div>
                  <label htmlFor="upload-worksheet-select" className="block text-sm font-medium text-gray-700 mb-1.5">Worksheet</label>
                  <select
                    id="upload-worksheet-select"
                    value={selectedSheet}
                    onChange={(e) => setSelectedSheet(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    {sheetNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              )}

              <button
                onClick={handleUpload}
                disabled={!selectedFile || uploading || (sheetNames.length > 0 && !selectedSheet)}
                className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {uploading ? "Processing…" : "Upload and validate"}
              </button>

              {uploading && <UploadProgressBanner />}
            </div>

            {uploadError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
                {uploadError}
              </div>
            )}

            {result && <ValidationResults result={result} />}

            {/* Upload history */}
            {uploads.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900">Upload history</h2>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left">
                      <th className="px-6 py-3 font-medium text-gray-500">File</th>
                      <th className="px-6 py-3 font-medium text-gray-500">File Format</th>
                      <th className="px-6 py-3 font-medium text-gray-500">Uploaded By</th>
                      <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                      <th className="px-6 py-3 font-medium text-gray-500">Errors</th>
                      <th className="px-6 py-3 font-medium text-gray-500">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploads.map((u) => (
                      <tr key={u.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-6 py-3 text-gray-900 font-medium max-w-[200px] truncate">
                          {u.blobUrl ? (
                            <a href={u.blobUrl} className="text-brand-600 hover:underline" target="_blank" rel="noreferrer">
                              {u.fileName}
                            </a>
                          ) : u.fileName}
                        </td>
                        <td className="px-6 py-3 text-gray-500">{u.schemaName}</td>
                        <td className="px-6 py-3 text-gray-500">{u.uploadedBy}</td>
                        <td className="px-6 py-3"><StatusBadge status={u.status} /></td>
                        <td className="px-6 py-3 text-gray-500">
                          {u.errorCount > 0
                            ? <span className="text-red-600 font-medium">{u.errorCount}</span>
                            : <span className="text-gray-500">—</span>}
                        </td>
                        <td className="px-6 py-3 text-gray-500 text-xs">
                          {new Date(u.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Manual Entry tab */}
        {activeTab === "entry" && selectedSchema && (
          <DataEntryTable
            schema={selectedSchema}
            projectId={selectedProjectId}
            onSubmitSuccess={refreshHistory}
          />
        )}

        {/* Dashboard tab */}
        {activeTab === "dashboard" && (
          selectedSchemaId && selectedProjectId
            ? <DashboardPanel schemaId={selectedSchemaId} projectId={selectedProjectId} />
            : (
              <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center text-sm text-gray-500">
                Select a project and file format to view the dashboard.
              </div>
            )
        )}

        {activeTab === "files" && (
          selectedProjectId
            ? <FilesPanel projectId={selectedProjectId} />
            : (
              <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center text-sm text-gray-500">
                Select a project to browse files.
              </div>
            )
        )}

      </div>
    </div>
  );
}

/**
 * Uploader-facing "Value Requirements" cell. Shows the admin's optional
 * description. For value lists, the allowed values are also listed, with a note
 * when matching is case-insensitive; other rule types rely on the description.
 */
function ValueRequirements({ c }: { c: Classification }) {
  // Value lists always render their pills; other types rely on the description,
  // so fall back to a dash when one wasn't provided rather than show a blank cell.
  if (c.type !== "VALUE_LIST" && !c.description) {
    return <span aria-hidden="true" className="text-gray-500">—</span>;
  }

  return (
    <div className="space-y-1">
      {c.description && <p className="text-gray-600 max-w-xs whitespace-normal">{c.description}</p>}

      {c.type === "VALUE_LIST" && (
        <>
          <div className="flex flex-wrap gap-1">
            {c.values.map((v) => (
              <span
                key={v}
                className="inline-flex items-center rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-green-700 font-medium whitespace-nowrap"
              >
                {v}
              </span>
            ))}
          </div>
          {!c.caseSensitive && <p className="text-gray-400 italic">Case insensitive</p>}
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    VALID: "bg-green-100 text-green-700",
    INVALID: "bg-red-100 text-red-700",
    PENDING: "bg-gray-100 text-gray-600",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.PENDING}`}
    >
      {status}
    </span>
  );
}

function UploadProgressBanner() {
  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 flex items-center gap-3">
      <Spinner />
      <span className="text-sm text-brand-700 font-medium">
        Scanning and validating (this may take a few minutes)…
      </span>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 text-brand-600 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <div className="flex justify-center">
      <svg aria-hidden="true" className="w-10 h-10 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
    </div>
  );
}

type ProjectResource = {
  id: string;
  fileName: string;
  filePath: string | null;
  contentType: string | null;
  organizationIds: string[];
  createdAt: string;
};

function normalizePath(p: string | null | undefined): string {
  return (p ?? "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "").trim();
}

function FilesPanel({ projectId }: { projectId: string }) {
  const [resources, setResources] = useState<ProjectResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setCurrentPath("");
    fetch(`/api/projects/${projectId}/resources`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setResources)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const { filesAtLevel, subfolders } = useMemo(() => {
    const filesAtLevel: ProjectResource[] = [];
    const subfolderSet = new Set<string>();

    for (const r of resources) {
      const rPath = normalizePath(r.filePath);
      if (rPath === currentPath) {
        filesAtLevel.push(r);
      } else if (currentPath === "" && rPath !== "") {
        subfolderSet.add(rPath.split("/")[0]);
      } else if (currentPath !== "" && rPath.startsWith(currentPath + "/")) {
        const remaining = rPath.slice(currentPath.length + 1);
        subfolderSet.add(remaining.split("/")[0]);
      }
    }

    return {
      filesAtLevel,
      subfolders: [...subfolderSet].sort((a, b) => a.localeCompare(b)),
    };
  }, [resources, currentPath]);

  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    return currentPath.split("/");
  }, [currentPath]);

  async function handleFileAction(r: ProjectResource, disposition: "inline" | "attachment") {
    setDownloading(r.id);
    setDownloadError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/resources/${r.id}/download?disposition=${disposition}`
      );
      if (!res.ok) {
        setDownloadError("Action failed. Please try again.");
        return;
      }
      const { downloadUrl } = await res.json();
      if (disposition === "inline") {
        window.open(downloadUrl, "_blank", "noopener,noreferrer");
      } else {
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = r.fileName;
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } finally {
      setDownloading(null);
    }
  }

  function navigateTo(path: string) {
    setCurrentPath(path);
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center text-sm text-gray-400">
        Loading…
      </div>
    );
  }

  if (resources.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center text-sm text-gray-400">
        No files available for this project.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {downloadError && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-red-50 border-b border-red-100 text-sm text-red-700">
          <span>{downloadError}</span>
          <button onClick={() => setDownloadError(null)} className="shrink-0 text-red-400 hover:text-red-600 leading-none">✕</button>
        </div>
      )}
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-4 py-3 border-b border-gray-100 text-sm bg-gray-50">
        <button
          onClick={() => navigateTo("")}
          className={currentPath === "" ? "font-medium text-gray-700" : "text-brand-600 hover:underline"}
        >
          Files
        </button>
        {breadcrumbs.map((segment, i) => {
          const path = breadcrumbs.slice(0, i + 1).join("/");
          const isLast = i === breadcrumbs.length - 1;
          return (
            <span key={path} className="flex items-center gap-1">
              <span className="text-gray-300">/</span>
              {isLast ? (
                <span className="font-medium text-gray-700">{segment}</span>
              ) : (
                <button onClick={() => navigateTo(path)} className="text-brand-600 hover:underline">
                  {segment}
                </button>
              )}
            </span>
          );
        })}
      </div>

      {/* Directory contents */}
      <div className="divide-y divide-gray-100">
        {subfolders.length === 0 && filesAtLevel.length === 0 && (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            This folder is empty.
          </div>
        )}

        {/* Folders */}
        {subfolders.map((folder) => {
          const targetPath = currentPath ? `${currentPath}/${folder}` : folder;
          return (
            <button
              key={folder}
              onClick={() => navigateTo(targetPath)}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-50 transition-colors group"
            >
              <FolderIcon />
              <span className="flex-1 text-gray-800 font-medium group-hover:text-brand-700">
                {folder}
              </span>
              <ChevronIcon />
            </button>
          );
        })}

        {/* Files */}
        {filesAtLevel.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50">
            <FileDocIcon contentType={r.contentType} />
            <span className="flex-1 text-gray-700 truncate">{r.fileName}</span>
            {downloading === r.id ? (
              <span className="shrink-0 text-xs text-gray-400">Loading…</span>
            ) : (
              <span className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => handleFileAction(r, "inline")}
                  title="View in browser"
                  className="p-1.5 rounded text-gray-400 hover:text-brand-600 hover:bg-gray-100 transition-colors"
                >
                  <EyeIcon />
                </button>
                <button
                  onClick={() => handleFileAction(r, "attachment")}
                  title="Download"
                  className="p-1.5 rounded text-gray-400 hover:text-brand-600 hover:bg-gray-100 transition-colors"
                >
                  <DownloadIcon />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg className="w-5 h-5 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function FileDocIcon({ contentType }: { contentType: string | null }) {
  const ct = contentType ?? "";
  let color = "text-gray-400";
  if (ct.includes("pdf")) color = "text-red-400";
  else if (ct.includes("spreadsheet") || ct.includes("excel") || ct.includes("csv")) color = "text-green-500";
  else if (ct.includes("word") || ct.includes("document")) color = "text-blue-400";
  else if (ct.includes("image")) color = "text-purple-400";
  return (
    <svg className={`w-5 h-5 shrink-0 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}
