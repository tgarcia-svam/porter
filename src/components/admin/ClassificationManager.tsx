"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

type Classification = {
  id: string;
  name: string;
  values: string[];
  _count: { columns: number };
};

export default function ClassificationManager({
  initialClassifications,
}: {
  initialClassifications: Classification[];
}) {
  const router = useRouter();
  const [classifications, setClassifications] = useState<Classification[]>(initialClassifications);

  // New classification form
  const [newName, setNewName] = useState("");
  const [newValueInput, setNewValueInput] = useState("");
  const [newValues, setNewValues] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editValueInput, setEditValueInput] = useState("");
  const [editValues, setEditValues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/classifications");
    if (res.ok) setClassifications(await res.json());
  }

  // ── Value tag helpers ──────────────────────────────────────────────────────

  function addNewValue() {
    const v = newValueInput.trim();
    if (!v || newValues.includes(v)) return;
    setNewValues((prev) => [...prev, v]);
    setNewValueInput("");
  }

  function removeNewValue(v: string) {
    setNewValues((prev) => prev.filter((x) => x !== v));
  }

  function addEditValue() {
    const v = editValueInput.trim();
    if (!v || editValues.includes(v)) return;
    setEditValues((prev) => [...prev, v]);
    setEditValueInput("");
  }

  function removeEditValue(v: string) {
    setEditValues((prev) => prev.filter((x) => x !== v));
  }

  // ── Add ───────────────────────────────────────────────────────────────────

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    const allValues = newValueInput.trim()
      ? [...newValues, newValueInput.trim()]
      : newValues;
    const unique = [...new Set(allValues)];
    if (unique.length === 0) {
      setAddError("Add at least one expected value.");
      return;
    }
    setAdding(true);
    try {
      const res = await apiFetch("/api/classifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), values: unique }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create classification");
      }
      setNewName("");
      setNewValues([]);
      setNewValueInput("");
      await refresh();
      router.refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to create classification");
    } finally {
      setAdding(false);
    }
  }

  // ── Edit ──────────────────────────────────────────────────────────────────

  function startEdit(c: Classification) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditValues([...c.values]);
    setEditValueInput("");
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function handleSave(id: string) {
    setEditError(null);
    const allValues = editValueInput.trim()
      ? [...editValues, editValueInput.trim()]
      : editValues;
    const unique = [...new Set(allValues)];
    if (unique.length === 0) {
      setEditError("At least one value is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/classifications/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), values: unique }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save");
      }
      setEditingId(null);
      await refresh();
      router.refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(id: string, name: string, columnCount: number) {
    const warn = columnCount > 0
      ? ` It is currently assigned to ${columnCount} column${columnCount === 1 ? "" : "s"} — those assignments will be cleared.`
      : "";
    if (!confirm(`Delete classification "${name}"?${warn}`)) return;
    await apiFetch(`/api/classifications/${id}`, { method: "DELETE" });
    await refresh();
    router.refresh();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">New classification</h2>
        <form onSubmit={handleAdd} className="space-y-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Classification name (e.g. Product Category)"
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Expected values
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newValueInput}
                onChange={(e) => setNewValueInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addNewValue(); }
                  if (e.key === ",") { e.preventDefault(); addNewValue(); }
                }}
                placeholder="Type a value and press Enter"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={addNewValue}
                disabled={!newValueInput.trim()}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                Add
              </button>
            </div>
            {newValues.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {newValues.map((v) => (
                  <span
                    key={v}
                    className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20"
                  >
                    {v}
                    <button
                      type="button"
                      onClick={() => removeNewValue(v)}
                      className="ml-0.5 text-green-500 hover:text-green-700"
                      aria-label={`Remove ${v}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {addError && <p className="text-sm text-red-600">{addError}</p>}

          <button
            type="submit"
            disabled={adding || !newName.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {adding ? "Creating…" : "Create classification"}
          </button>
        </form>
      </div>

      {/* List */}
      {classifications.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-gray-400 text-sm">No classifications yet. Create one above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {classifications.map((c) =>
            editingId === c.id ? (
              // ── Edit row ──────────────────────────────────────────────────
              <div key={c.id} className="bg-white rounded-xl border border-blue-200 p-5 space-y-3">
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">
                    Expected values
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editValueInput}
                      onChange={(e) => setEditValueInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); addEditValue(); }
                        if (e.key === ",") { e.preventDefault(); addEditValue(); }
                      }}
                      placeholder="Type a value and press Enter"
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={addEditValue}
                      disabled={!editValueInput.trim()}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                  {editValues.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {editValues.map((v) => (
                        <span
                          key={v}
                          className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20"
                        >
                          {v}
                          <button
                            type="button"
                            onClick={() => removeEditValue(v)}
                            className="ml-0.5 text-green-500 hover:text-green-700"
                            aria-label={`Remove ${v}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {editError && <p className="text-sm text-red-600">{editError}</p>}

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleSave(c.id)}
                    disabled={saving || !editName.trim()}
                    className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="text-sm text-gray-500 hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              // ── Read row ──────────────────────────────────────────────────
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-900">{c.name}</span>
                      <span className="text-xs text-gray-400">
                        {c._count.columns} column{c._count.columns === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.values.map((v) => (
                        <span
                          key={v}
                          className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20"
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-3 text-xs">
                    <button
                      onClick={() => startEdit(c)}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(c.id, c.name, c._count.columns)}
                      className="text-red-500 hover:underline font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
