"use client";

import { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import ValidationResults from "./ValidationResults";
import DataEntryTable from "./DataEntryTable";

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
  description: string | null;
  columns: Column[];
};

type Project = {
  id: string;
  name: string;
  schemas: Schema[];
};

type UploadRecord = {
  id: string;
  fileName: string;
  schemaName: string;
  status: string;
  errorCount: number;
  createdAt: string;
  blobUrl: string | null;
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
  errors: ValidationError[];
};

export default function FileUploader({
  projects,
  initialUploads,
}: {
  projects: Project[];
  initialUploads: UploadRecord[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedProjectId, setSelectedProjectId] = useState(
    projects[0]?.id ?? ""
  );
  const [selectedSchemaId, setSelectedSchemaId] = useState(
    projects[0]?.schemas[0]?.id ?? ""
  );
  const [activeTab, setActiveTab] = useState<"upload" | "entry">("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
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

  function handleTabChange(tab: "upload" | "entry") {
    setActiveTab(tab);
    clearFileState();
  }

  function handleProjectChange(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    setSelectedProjectId(projectId);
    setSelectedSchemaId(project?.schemas[0]?.id ?? "");
    clearFileState();
  }

  async function handleFileSelect(file: File) {
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
      const workbook = XLSX.read(arrayBuffer, { type: "array", bookSheets: true });
      setSheetNames(workbook.SheetNames);
      setSelectedSheet(workbook.SheetNames[0] ?? "");
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
        }) => ({
          id: u.id,
          fileName: u.fileName,
          schemaName: u.schema.name,
          status: u.status,
          errorCount: u.errorCount,
          createdAt: u.createdAt,
          blobUrl: u.blobUrl,
        }))
      );
    }
    router.refresh();
  }

  async function handleUpload() {
    if (!selectedFile || !selectedSchemaId) return;
    setUploading(true);
    setResult(null);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("schemaId", selectedSchemaId);
      if (selectedSheet) formData.append("sheetName", selectedSheet);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setUploadError(data?.error ?? "An unexpected error occurred. Please try again.");
        return;
      }

      setResult(data as UploadResult);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshHistory();
    } finally {
      setUploading(false);
    }
  }

  if (projects.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
        <p className="text-gray-500 text-sm font-medium">No projects available</p>
        <p className="mt-1 text-gray-400 text-sm">
          An administrator needs to assign your organization to a project with
          schemas before you can upload files.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Shared context: project + schema selectors */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Project selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Project
          </label>
          <select
            value={selectedProjectId}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Schema selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            File Format
          </label>
          <select
            value={selectedSchemaId}
            onChange={(e) => {
              setSelectedSchemaId(e.target.value);
              clearFileState();
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {availableSchemas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {selectedSchema?.description && (
            <p className="mt-1 text-xs text-gray-400">{selectedSchema.description}</p>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-1">
          {(["upload", "entry"] as const).map((tab) => {
            const labels = { upload: "File Upload", entry: "Manual Entry" };
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </nav>
      </div>

      {/* File upload tab */}
      {activeTab === "upload" && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            {/* Schema column preview */}
            {selectedSchema && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">
                  Expected columns:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedSchema.columns.map((col) => (
                    <span
                      key={col.id}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs"
                    >
                      <span className="font-medium font-mono text-gray-700">
                        {col.name}
                      </span>
                      <span className="text-gray-400">{col.dataType}</span>
                      {col.required && (
                        <span className="text-red-400 font-bold">*</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragging
                  ? "border-blue-400 bg-blue-50"
                  : selectedFile
                  ? "border-green-400 bg-green-50"
                  : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
              />
              {selectedFile ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-center gap-2">
                    <FileIcon />
                    <span className="text-sm font-medium text-gray-900">
                      {selectedFile.name}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    {(selectedFile.size / 1024).toFixed(1)} KB — click to change
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <UploadIcon />
                  <p className="text-sm font-medium text-gray-600">
                    Drop a CSV or Excel file here
                  </p>
                  <p className="text-xs text-gray-400">or click to browse</p>
                </div>
              )}
            </div>

            {/* Worksheet selector — Excel only */}
            {sheetNames.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Worksheet
                </label>
                <select
                  value={selectedSheet}
                  onChange={(e) => setSelectedSheet(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {sheetNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploading || (sheetNames.length > 0 && !selectedSheet)}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {uploading ? "Validating & uploading…" : "Upload and validate"}
            </button>
          </div>

          {uploadError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
              {uploadError}
            </div>
          )}

          {result && <ValidationResults result={result} />}
        </>
      )}

      {/* Manual entry tab */}
      {activeTab === "entry" && selectedSchema && (
        <DataEntryTable
          schema={selectedSchema}
          projectId={selectedProjectId}
          onSubmitSuccess={refreshHistory}
        />
      )}

      {/* Upload history — always visible */}
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
                      <a
                        href={u.blobUrl}
                        className="text-blue-600 hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {u.fileName}
                      </a>
                    ) : (
                      u.fileName
                    )}
                  </td>
                  <td className="px-6 py-3 text-gray-500">{u.schemaName}</td>
                  <td className="px-6 py-3">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-6 py-3 text-gray-500">
                    {u.errorCount > 0 ? (
                      <span className="text-red-600 font-medium">{u.errorCount}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-gray-400 text-xs">
                    {new Date(u.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
    </div>
  );
}
