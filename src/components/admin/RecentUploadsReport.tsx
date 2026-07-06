"use client";

import { useEffect, useState } from "react";
import Spinner from "@/components/Spinner";

type Row = {
  id: string;
  project: string | null;
  fileFormat: string;
  fileName: string;
  date: string;
  status: string;
  user: string;
  organization: string | null;
};

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    VALID: "bg-green-100 text-green-700",
    INVALID: "bg-red-100 text-red-700",
    PENDING: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.PENDING}`}>
      {status}
    </span>
  );
}

export default function RecentUploadsReport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/uploads/recent?page=${page}&pageSize=20`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setRows(d.rows ?? []);
        if (d.pagination) setPagination(d.pagination);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900">Recent Uploads</h3>
        {pagination.total > 0 && (
          <span className="text-xs text-gray-500">{pagination.total} total</span>
        )}
      </div>

      {loading ? (
        <div className="px-6 py-12 flex justify-center">
          <Spinner size="lg" label="Loading uploads" />
        </div>
      ) : rows.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-gray-500">No uploads yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 font-medium text-gray-500">Project</th>
                <th className="px-6 py-3 font-medium text-gray-500">File Format</th>
                <th className="px-6 py-3 font-medium text-gray-500">Date</th>
                <th className="px-6 py-3 font-medium text-gray-500">User</th>
                <th className="px-6 py-3 font-medium text-gray-500">Organization</th>
                <th className="px-6 py-3 font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-6 py-3 text-gray-600">{r.project ?? "—"}</td>
                  <td className="px-6 py-3 text-gray-900 font-medium">{r.fileFormat}</td>
                  <td className="px-6 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {new Date(r.date).toLocaleString()}
                  </td>
                  <td className="px-6 py-3 text-gray-600">{r.user}</td>
                  <td className="px-6 py-3 text-gray-600">{r.organization ?? "—"}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 text-sm">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-md border border-gray-300 px-3 py-1 text-gray-700 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-gray-500">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= pagination.totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-gray-300 px-3 py-1 text-gray-700 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
