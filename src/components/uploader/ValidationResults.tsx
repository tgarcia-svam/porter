"use client";

import { useState } from "react";

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

const PAGE_SIZE = 25;

export default function ValidationResults({ result }: { result: UploadResult }) {
  const [page, setPage] = useState(0);

  const isValid = result.status === "VALID";
  const totalPages = Math.ceil(result.errors.length / PAGE_SIZE);
  const pageErrors = result.errors.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div
        className={`rounded-xl border px-5 py-4 flex items-start gap-3 ${
          isValid
            ? "bg-green-50 border-green-200"
            : "bg-red-50 border-red-200"
        }`}
      >
        <div
          className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
            isValid ? "bg-green-100" : "bg-red-100"
          }`}
        >
          {isValid ? (
            <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </div>
        <div>
          <p className={`font-semibold text-sm ${isValid ? "text-green-800" : "text-red-800"}`}>
            {isValid ? "File is valid" : `${result.errorCount} validation error${result.errorCount !== 1 ? "s" : ""} found`}
          </p>
          <p className={`mt-0.5 text-xs ${isValid ? "text-green-600" : "text-red-600"}`}>
            {result.rowCount} row{result.rowCount !== 1 ? "s" : ""} processed
            {isValid
              ? " — all values meet the file format requirements."
              : " — fix the errors below and re-upload."}
          </p>
        </div>
      </div>

      {/* Error table */}
      {result.errors.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">
              Validation errors
            </h3>
            <span className="text-xs text-gray-400">
              Showing {page * PAGE_SIZE + 1}–
              {Math.min((page + 1) * PAGE_SIZE, result.errors.length)} of{" "}
              {result.errors.length}
            </span>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs">
                <th className="px-5 py-2.5 font-medium text-gray-500 w-16">Row</th>
                <th className="px-5 py-2.5 font-medium text-gray-500">Column</th>
                <th className="px-5 py-2.5 font-medium text-gray-500">Value</th>
                <th className="px-5 py-2.5 font-medium text-gray-500">Error</th>
              </tr>
            </thead>
            <tbody>
              {pageErrors.map((err, i) => (
                <tr
                  key={i}
                  className="border-b border-gray-50 last:border-0 hover:bg-red-50/40 transition-colors"
                >
                  <td className="px-5 py-2.5 text-gray-400 text-xs font-mono">
                    {err.row === 0 ? "header" : err.row}
                  </td>
                  <td className="px-5 py-2.5 text-gray-700 font-mono font-medium text-xs">
                    {err.column || "—"}
                  </td>
                  <td className="px-5 py-2.5 max-w-[180px]">
                    {err.value ? (
                      <span className="inline-block rounded bg-red-100 text-red-700 px-1.5 py-0.5 text-xs font-mono truncate max-w-full">
                        {err.value}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs italic">empty</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-red-600 text-xs">{err.error}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-40"
              >
                ← Previous
              </button>
              <span className="text-xs text-gray-400">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
