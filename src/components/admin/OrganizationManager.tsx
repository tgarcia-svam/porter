"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

type Organization = {
  id: string;
  name: string;
  _count: { users: number };
};

export default function OrganizationManager({
  initialOrganizations,
}: {
  initialOrganizations: Organization[];
}) {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>(initialOrganizations);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function refresh() {
    const res = await fetch("/api/organizations");
    if (res.ok) setOrganizations(await res.json());
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAdding(true);
    try {
      const res = await apiFetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to add organization");
      }
      setNewName("");
      await refresh();
      router.refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add organization");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete organization "${name}"? Users in this organization will be unassigned.`)) return;
    await apiFetch(`/api/organizations/${id}`, { method: "DELETE" });
    await refresh();
    router.refresh();
  }

  function startEdit(org: Organization) {
    setEditingId(org.id);
    setEditName(org.name);
  }

  async function handleRename(id: string) {
    if (!editName.trim()) return;
    await apiFetch(`/api/organizations/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    setEditingId(null);
    await refresh();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Add organization</h2>
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Organization name"
            required
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={adding || !newName.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </form>
        {addError && <p className="mt-2 text-sm text-red-600">{addError}</p>}
      </div>

      {/* Organizations list */}
      {organizations.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-gray-400 text-sm">No organizations yet. Add one above.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {organizations.map((org) => (
            <div key={org.id} className="flex items-center gap-3 px-5 py-3.5">
              {editingId === org.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(org.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="flex-1 rounded-md border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <span className="flex-1 text-sm font-medium text-gray-900">{org.name}</span>
              )}

              <span className="text-xs text-gray-400">
                {org._count.users} {org._count.users === 1 ? "user" : "users"}
              </span>

              {editingId === org.id ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRename(org.id)}
                    className="text-xs text-blue-600 hover:underline font-medium"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-xs text-gray-400 hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => startEdit(org)}
                    className="text-xs text-blue-600 hover:underline font-medium"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => handleDelete(org.id, org.name)}
                    className="text-xs text-red-500 hover:underline font-medium"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
