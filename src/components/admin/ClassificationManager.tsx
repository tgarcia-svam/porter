"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

type ClassificationType = "VALUE_LIST" | "REGEX" | "NUMBER_RANGE" | "DATE_RANGE";

type Classification = {
  id: string;
  name: string;
  description: string | null;
  type: ClassificationType;
  values: string[];
  caseSensitive: boolean;
  pattern: string | null;
  minNumber: number | null;
  maxNumber: number | null;
  minDate: string | null; // ISO datetime (date-only column)
  maxDate: string | null;
  _count: { columns: number };
};

// ── Form model ────────────────────────────────────────────────────────────────
// The UI flow is "pick a data type, then (for text) a mode". We track those two
// choices plus every type's fields, and collapse them to the API discriminant
// only at submit time.

type DataType = "TEXT" | "NUMBER" | "DATE";
type TextMode = "VALUE_LIST" | "REGEX";

type FormValue = {
  name: string;
  description: string;
  dataType: DataType;
  textMode: TextMode;
  values: string[];
  caseSensitive: boolean;
  pattern: string;
  minNumber: string;
  maxNumber: string;
  minDate: string;
  maxDate: string;
};

const EMPTY_FORM: FormValue = {
  name: "",
  description: "",
  dataType: "TEXT",
  textMode: "VALUE_LIST",
  values: [],
  caseSensitive: true,
  pattern: "",
  minNumber: "",
  maxNumber: "",
  minDate: "",
  maxDate: "",
};

function toFormValue(c: Classification): FormValue {
  return {
    name: c.name,
    description: c.description ?? "",
    dataType: c.type === "NUMBER_RANGE" ? "NUMBER" : c.type === "DATE_RANGE" ? "DATE" : "TEXT",
    textMode: c.type === "REGEX" ? "REGEX" : "VALUE_LIST",
    values: [...c.values],
    caseSensitive: c.caseSensitive,
    pattern: c.pattern ?? "",
    minNumber: c.minNumber != null ? String(c.minNumber) : "",
    maxNumber: c.maxNumber != null ? String(c.maxNumber) : "",
    minDate: c.minDate ? c.minDate.slice(0, 10) : "",
    maxDate: c.maxDate ? c.maxDate.slice(0, 10) : "",
  };
}

type BuildResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string };

/** Build the API request body from a form, or return a validation error message. */
function buildBody(f: FormValue): BuildResult {
  const name = f.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  const description = f.description.trim() || null;

  if (f.dataType === "TEXT" && f.textMode === "VALUE_LIST") {
    if (f.values.length === 0) return { ok: false, error: "Add at least one expected value." };
    return {
      ok: true,
      body: { type: "VALUE_LIST", name, description, values: f.values, caseSensitive: f.caseSensitive },
    };
  }
  if (f.dataType === "TEXT" && f.textMode === "REGEX") {
    const pattern = f.pattern.trim();
    if (!pattern) return { ok: false, error: "Enter a regex pattern." };
    try {
      new RegExp(pattern);
    } catch {
      return { ok: false, error: "Invalid regular expression." };
    }
    return { ok: true, body: { type: "REGEX", name, description, pattern, caseSensitive: f.caseSensitive } };
  }
  if (f.dataType === "NUMBER") {
    const min = f.minNumber.trim() === "" ? null : Number(f.minNumber);
    const max = f.maxNumber.trim() === "" ? null : Number(f.maxNumber);
    if (min === null && max === null)
      return { ok: false, error: "Specify a minimum, a maximum, or both." };
    if ((min !== null && Number.isNaN(min)) || (max !== null && Number.isNaN(max)))
      return { ok: false, error: "Enter valid numbers." };
    if (min !== null && max !== null && min > max)
      return { ok: false, error: "Minimum must be less than or equal to maximum." };
    return { ok: true, body: { type: "NUMBER_RANGE", name, description, minNumber: min, maxNumber: max } };
  }
  // DATE
  const min = f.minDate || null;
  const max = f.maxDate || null;
  if (!min && !max) return { ok: false, error: "Specify a start date, an end date, or both." };
  if (min && max && min > max)
    return { ok: false, error: "Start date must be on or before end date." };
  return { ok: true, body: { type: "DATE_RANGE", name, description, minDate: min, maxDate: max } };
}

// ── Display helpers ─────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<ClassificationType, string> = {
  VALUE_LIST: "Value list",
  REGEX: "Regex",
  NUMBER_RANGE: "Number range",
  DATE_RANGE: "Date range",
};

function rangeSummary(min: string | null, max: string | null, unit: (v: string) => string): string {
  if (min != null && max != null) return `${unit(min)} – ${unit(max)}`;
  if (min != null) return `≥ ${unit(min)}`;
  return `≤ ${unit(max as string)}`;
}

export default function ClassificationManager({
  initialClassifications,
}: {
  initialClassifications: Classification[];
}) {
  const router = useRouter();
  const [classifications, setClassifications] = useState<Classification[]>(initialClassifications);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/classifications");
    if (res.ok) setClassifications(await res.json());
    router.refresh();
  }

  async function handleDelete(id: string, name: string, columnCount: number) {
    const warn =
      columnCount > 0
        ? ` It is currently assigned to ${columnCount} column${columnCount === 1 ? "" : "s"} — those assignments will be cleared.`
        : "";
    if (!confirm(`Delete classification "${name}"?${warn}`)) return;
    await apiFetch(`/api/classifications/${id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">New classification</h2>
        <ClassificationForm
          key="add"
          submitLabel="Create classification"
          onSubmit={async (body) => {
            const res = await apiFetch("/api/classifications", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error ?? "Failed to create classification");
            }
            await refresh();
          }}
          resetOnSubmit
        />
      </div>

      {/* List */}
      {classifications.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-gray-500 text-sm">No classifications yet. Create one above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {classifications.map((c) =>
            editingId === c.id ? (
              <div key={c.id} className="bg-white rounded-xl border border-brand-200 p-5">
                <ClassificationForm
                  key={c.id}
                  initial={toFormValue(c)}
                  submitLabel="Save"
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (body) => {
                    const res = await apiFetch(`/api/classifications/${c.id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(body),
                    });
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({}));
                      throw new Error(data.error ?? "Failed to save");
                    }
                    setEditingId(null);
                    await refresh();
                  }}
                />
              </div>
            ) : (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-900">{c.name}</span>
                      <span className="text-xs rounded-full px-2 py-0.5 ring-1 ring-inset bg-brand-50 text-brand-700 ring-brand-200">
                        {TYPE_LABEL[c.type]}
                      </span>
                      <span className="text-xs text-gray-500">
                        {c._count.columns} column{c._count.columns === 1 ? "" : "s"}
                      </span>
                      {(c.type === "VALUE_LIST" || c.type === "REGEX") && (
                        <span
                          className={`text-xs rounded-full px-2 py-0.5 ring-1 ring-inset ${
                            c.caseSensitive
                              ? "bg-gray-50 text-gray-500 ring-gray-200"
                              : "bg-amber-50 text-amber-700 ring-amber-200"
                          }`}
                        >
                          {c.caseSensitive ? "case sensitive" : "case insensitive"}
                        </span>
                      )}
                    </div>
                    {c.description && <p className="text-xs text-gray-500">{c.description}</p>}
                    <ClassificationSummary c={c} />
                  </div>
                  <div className="shrink-0 flex items-center gap-3 text-xs">
                    <button
                      onClick={() => setEditingId(c.id)}
                      className="text-brand-600 hover:underline font-medium"
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

// ── Read-only summary of a classification's constraint ──────────────────────────

function ClassificationSummary({ c }: { c: Classification }) {
  if (c.type === "VALUE_LIST") {
    return (
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
    );
  }
  if (c.type === "REGEX") {
    return (
      <code className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-700">
        /{c.pattern}/{c.caseSensitive ? "" : "i"}
      </code>
    );
  }
  if (c.type === "NUMBER_RANGE") {
    return (
      <p className="text-xs text-gray-600">
        {rangeSummary(
          c.minNumber != null ? String(c.minNumber) : null,
          c.maxNumber != null ? String(c.maxNumber) : null,
          (v) => v
        )}
      </p>
    );
  }
  // DATE_RANGE
  return (
    <p className="text-xs text-gray-600">
      {rangeSummary(
        c.minDate ? c.minDate.slice(0, 10) : null,
        c.maxDate ? c.maxDate.slice(0, 10) : null,
        (v) => v
      )}
    </p>
  );
}

// ── Shared add/edit form ────────────────────────────────────────────────────────

function ClassificationForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  resetOnSubmit,
}: {
  initial?: FormValue;
  submitLabel: string;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
  resetOnSubmit?: boolean;
}) {
  const [form, setForm] = useState<FormValue>(initial ?? EMPTY_FORM);
  const [valueInput, setValueInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormValue>(key: K, value: FormValue[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addValue() {
    const v = valueInput.trim();
    if (!v || form.values.includes(v)) return;
    set("values", [...form.values, v]);
    setValueInput("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Fold a value still sitting in the input box into the list before building.
    const pending = valueInput.trim();
    const effective: FormValue =
      form.dataType === "TEXT" && form.textMode === "VALUE_LIST" && pending && !form.values.includes(pending)
        ? { ...form, values: [...form.values, pending] }
        : form;

    const result = buildBody(effective);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setBusy(true);
    try {
      await onSubmit(result.body);
      if (resetOnSubmit) {
        setForm(EMPTY_FORM);
        setValueInput("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const isText = form.dataType === "TEXT";
  const showCase = isText; // VALUE_LIST + REGEX

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="text"
        value={form.name}
        onChange={(e) => set("name", e.target.value)}
        placeholder="Classification name (e.g. Product Category)"
        required
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500"
      />

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">
          Description <span className="font-normal text-gray-400">(shown to uploaders)</span>
        </label>
        <textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Explain the rule, e.g. “Use the 3-letter ISO currency code.”"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {/* Data type */}
      <Segmented
        label="Data type"
        value={form.dataType}
        onChange={(v) => set("dataType", v as DataType)}
        options={[
          { value: "TEXT", label: "Text" },
          { value: "NUMBER", label: "Number" },
          { value: "DATE", label: "Date" },
        ]}
      />

      {/* Text mode */}
      {isText && (
        <Segmented
          label="Text mode"
          value={form.textMode}
          onChange={(v) => set("textMode", v as TextMode)}
          options={[
            { value: "VALUE_LIST", label: "Value list" },
            { value: "REGEX", label: "Regex" },
          ]}
        />
      )}

      {showCase && (
        <Segmented
          label="Value matching"
          value={form.caseSensitive ? "yes" : "no"}
          onChange={(v) => set("caseSensitive", v === "yes")}
          options={[
            { value: "yes", label: "Case sensitive" },
            { value: "no", label: "Case insensitive" },
          ]}
        />
      )}

      {/* VALUE_LIST */}
      {isText && form.textMode === "VALUE_LIST" && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Expected values</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={valueInput}
              onChange={(e) => setValueInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addValue();
                }
              }}
              placeholder="Type a value and press Enter"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={addValue}
              disabled={!valueInput.trim()}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Add
            </button>
          </div>
          {form.values.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {form.values.map((v) => (
                <span
                  key={v}
                  className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20"
                >
                  {v}
                  <button
                    type="button"
                    onClick={() => set("values", form.values.filter((x) => x !== v))}
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
      )}

      {/* REGEX */}
      {isText && form.textMode === "REGEX" && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Pattern</label>
          <input
            type="text"
            value={form.pattern}
            onChange={(e) => set("pattern", e.target.value)}
            placeholder="e.g. ^[A-Z]{3}-\d{4}$"
            spellCheck={false}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="mt-1 text-xs text-gray-400">
            Values must fully match this regular expression.
          </p>
        </div>
      )}

      {/* NUMBER_RANGE */}
      {form.dataType === "NUMBER" && (
        <RangeInputs
          label="Allowed range"
          hint="Leave a field blank for an open-ended bound."
          minType="number"
          maxType="number"
          minValue={form.minNumber}
          maxValue={form.maxNumber}
          onMin={(v) => set("minNumber", v)}
          onMax={(v) => set("maxNumber", v)}
        />
      )}

      {/* DATE_RANGE */}
      {form.dataType === "DATE" && (
        <RangeInputs
          label="Allowed date range"
          hint="Leave a field blank for an open-ended bound."
          minType="date"
          maxType="date"
          minValue={form.minDate}
          maxValue={form.maxDate}
          onMin={(v) => set("minDate", v)}
          onMax={(v) => set("maxDate", v)}
        />
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !form.name.trim()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:underline">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// ── Small presentational helpers ────────────────────────────────────────────────

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-medium text-gray-500 w-28 shrink-0">{label}</span>
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 transition-colors ${i > 0 ? "border-l border-gray-200" : ""} ${
              value === o.value ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-50"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RangeInputs({
  label,
  hint,
  minType,
  maxType,
  minValue,
  maxValue,
  onMin,
  onMax,
}: {
  label: string;
  hint: string;
  minType: "number" | "date";
  maxType: "number" | "date";
  minValue: string;
  maxValue: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
}) {
  const cls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type={minType}
          step={minType === "number" ? "any" : undefined}
          value={minValue}
          onChange={(e) => onMin(e.target.value)}
          placeholder="Minimum"
          aria-label="Minimum"
          className={cls}
        />
        <span className="text-gray-400 text-sm">to</span>
        <input
          type={maxType}
          step={maxType === "number" ? "any" : undefined}
          value={maxValue}
          onChange={(e) => onMax(e.target.value)}
          placeholder="Maximum"
          aria-label="Maximum"
          className={cls}
        />
      </div>
      <p className="mt-1 text-xs text-gray-400">{hint}</p>
    </div>
  );
}
