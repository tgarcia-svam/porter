"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import Spinner from "@/components/Spinner";

type OverdueItem = {
  scheduleId: string;
  projectId: string;
  projectName: string;
  organizationId: string;
  organizationName: string;
  schemaId: string;
  schemaName: string;
  dueDate: string;
};

function rowKey(i: OverdueItem): string {
  return `${i.scheduleId}|${i.organizationId}|${i.schemaId}|${i.dueDate}`;
}

export default function OverdueUploadsReport() {
  const [items, setItems] = useState<OverdueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/admin/overdue")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setItems(d.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function remove(item: OverdueItem) {
    const key = rowKey(item);
    setRemoving((prev) => new Set(prev).add(key));
    try {
      const res = await apiFetch("/api/admin/overdue/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleId: item.scheduleId,
          organizationId: item.organizationId,
          schemaId: item.schemaId,
          dueDate: item.dueDate,
        }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => rowKey(i) !== key));
      }
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900">Overdue Uploads</h3>
        {items.length > 0 && <span className="text-xs text-gray-500">{items.length} overdue</span>}
      </div>

      {loading ? (
        <div className="px-6 py-12 flex justify-center">
          <Spinner size="lg" label="Loading overdue uploads" />
        </div>
      ) : items.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-gray-500">No overdue uploads.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 font-medium text-gray-500">Project</th>
                <th className="px-6 py-3 font-medium text-gray-500">File Format</th>
                <th className="px-6 py-3 font-medium text-gray-500">Organization</th>
                <th className="px-6 py-3 font-medium text-gray-500">Due Date</th>
                <th className="px-6 py-3 font-medium text-gray-500 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const key = rowKey(i);
                return (
                  <tr key={key} className="border-b border-gray-50 last:border-0">
                    <td className="px-6 py-3 text-gray-600">{i.projectName}</td>
                    <td className="px-6 py-3 text-gray-900 font-medium">{i.schemaName}</td>
                    <td className="px-6 py-3 text-gray-600">{i.organizationName}</td>
                    <td className="px-6 py-3 text-gray-500 whitespace-nowrap">{i.dueDate}</td>
                    <td className="px-6 py-3 text-right">
                      <button
                        type="button"
                        disabled={removing.has(key)}
                        onClick={() => remove(i)}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                      >
                        {removing.has(key) ? "Removing…" : "Remove from List"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
