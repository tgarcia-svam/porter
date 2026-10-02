"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";

// ── Shared components ─────────────────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-6 py-4">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <p className="mt-0.5 text-sm text-gray-500">{description}</p>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function Feedback({ value }: { value: { ok: boolean; message: string } | null }) {
  if (!value) return null;
  return (
    <p className={`text-sm ${value.ok ? "text-green-600" : "text-red-600"}`}>
      {value.message}
    </p>
  );
}

const inputCls =
  "block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

const saveBtnCls =
  "inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50";

// ── Retention section ─────────────────────────────────────────────────────────

type RetentionSettings = {
  uploadSoftDeleteDays: number;
  uploadHardDeleteDays: number;
  auditLogRetentionDays: number;
};

type RetentionResult = {
  ranAt: string;
  settings: RetentionSettings;
  uploadsSoftDeleted: number;
  uploadsHardDeleted: number;
  auditLogsDeleted: number;
};

function RetentionSection() {
  const [settings, setSettings] = useState<RetentionSettings | null>(null);
  const [draft, setDraft] = useState<RetentionSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [lastRun, setLastRun] = useState<RetentionResult | null>(null);

  useEffect(() => {
    fetch("/api/admin/retention")
      .then((r) => r.json())
      .then((data: RetentionSettings) => {
        setSettings(data);
        setDraft(data);
      });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch("/api/admin/retention", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const updated = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, message: typeof updated.error === "string" ? updated.error : "Failed to save settings." });
        return;
      }
      setSettings(updated);
      setDraft(updated);
      setFeedback({ ok: true, message: "Retention settings saved." });
    } catch {
      setFeedback({ ok: false, message: "An error occurred while saving." });
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    setRunning(true);
    setFeedback(null);
    try {
      const res = await apiFetch("/api/admin/retention/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, message: "Retention sweep failed." });
        return;
      }
      setLastRun(data);
      setFeedback({
        ok: true,
        message: `Sweep complete: ${data.uploadsSoftDeleted} soft-deleted, ${data.uploadsHardDeleted} hard-deleted, ${data.auditLogsDeleted} audit rows removed.`,
      });
    } catch {
      setFeedback({ ok: false, message: "An error occurred while running retention." });
    } finally {
      setRunning(false);
    }
  }

  const setField = (k: keyof RetentionSettings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!draft) return;
    const n = parseInt(e.target.value, 10);
    setDraft({ ...draft, [k]: isNaN(n) || n < 0 ? 0 : n });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
      <SectionHeader
        title="Data Retention"
        description="Soft-delete uploads after N days; hard-delete them after M days. Set any value to 0 for unlimited retention. Runs daily via a scheduled job, or trigger manually below."
      />
      <form onSubmit={handleSave} className="px-6 py-5 space-y-5">
        <Field
          label="Soft-delete uploads after (days)"
          hint="Uploads older than this are hidden from users but kept in the database. 0 = never."
        >
          <input
            type="number"
            min={0}
            value={draft?.uploadSoftDeleteDays ?? 0}
            onChange={setField("uploadSoftDeleteDays")}
            className={inputCls}
          />
        </Field>
        <Field
          label="Hard-delete uploads after (days)"
          hint="Permanently removes uploads (including row data and validation errors). Must be ≥ soft-delete days. 0 = never."
        >
          <input
            type="number"
            min={0}
            value={draft?.uploadHardDeleteDays ?? 0}
            onChange={setField("uploadHardDeleteDays")}
            className={inputCls}
          />
        </Field>
        <Field
          label="Audit log retention (days)"
          hint="Audit log entries older than this are permanently removed. 0 = never."
        >
          <input
            type="number"
            min={0}
            value={draft?.auditLogRetentionDays ?? 0}
            onChange={setField("auditLogRetentionDays")}
            className={inputCls}
          />
        </Field>
        <Feedback value={feedback} />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving || !draft} className={saveBtnCls}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={handleRunNow}
            disabled={running || !settings}
            className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {running ? "Running…" : "Run sweep now"}
          </button>
        </div>
        {lastRun && (
          <p className="text-xs text-gray-500">
            Last sweep at {new Date(lastRun.ranAt).toLocaleString()}:
            {" "}{lastRun.uploadsSoftDeleted} soft-deleted,
            {" "}{lastRun.uploadsHardDeleted} hard-deleted,
            {" "}{lastRun.auditLogsDeleted} audit rows removed.
          </p>
        )}
      </form>
    </div>
  );
}

// ── Warehouse export section ──────────────────────────────────────────────────

type WarehouseExportConfig = {
  enabled: boolean;
  accountUrl: string;
  tenantId: string;
  clientId: string;
  container: string;
  rootPath: string;
  managedIdentityConfigured: boolean;
  managedIdentityPrincipalId: string | null;
};

function WarehouseExportSection() {
  const [config, setConfig] = useState<WarehouseExportConfig | null>(null);
  const [draft, setDraft] = useState<WarehouseExportConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/warehouse-export")
      .then((r) => r.json())
      .then((data: WarehouseExportConfig) => {
        setConfig(data);
        setDraft(data);
      });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch("/api/admin/warehouse-export", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: draft.enabled,
          accountUrl: draft.accountUrl,
          tenantId: draft.tenantId,
          clientId: draft.clientId,
          container: draft.container,
          rootPath: draft.rootPath,
        }),
      });
      const updated = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, message: typeof updated.error === "string" ? updated.error : "Failed to save settings." });
        return;
      }
      setConfig(updated);
      setDraft(updated);
      setFeedback({ ok: true, message: "Warehouse export settings saved." });
    } catch {
      setFeedback({ ok: false, message: "An error occurred while saving." });
    } finally {
      setSaving(false);
    }
  }

  const setText = (k: "accountUrl" | "tenantId" | "clientId" | "container" | "rootPath") =>
    (e: React.ChangeEvent<HTMLInputElement>) => draft && setDraft({ ...draft, [k]: e.target.value });

  return (
    <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
      <SectionHeader
        title="Data Warehouse Export"
        description="When enabled, each upload that passes validation is written as a Parquet file to an external storage container for downstream warehouse ingestion. Auth is secret-less via a cross-tenant managed identity; configure the destination below."
      />
      <form onSubmit={handleSave} className="px-6 py-5 space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Managed identity (federation)</span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                config?.managedIdentityConfigured
                  ? "bg-green-50 text-green-700 ring-green-600/20"
                  : "bg-red-50 text-red-700 ring-red-600/20"
              }`}
            >
              {config === null ? "Loading…" : config.managedIdentityConfigured ? "Available" : "Not available"}
            </span>
          </div>
          <p className="text-xs text-gray-500">
            Porter federates into the data team&apos;s app using a managed identity provisioned by the
            deployment. This is the only piece not editable here; it is absent in local dev, so exports
            are skipped there even when enabled.
          </p>
          {config?.managedIdentityPrincipalId && (
            <div className="rounded-md bg-gray-50 px-3 py-2">
              <div className="text-xs font-medium text-gray-700">
                Principal (object) ID — federated credential <span className="font-semibold">Subject</span>
              </div>
              <p className="mt-0.5 font-mono text-xs text-gray-600 break-all select-all">
                {config.managedIdentityPrincipalId}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Give this to the data team as the <strong>Subject</strong> of the federated identity
                credential on their app (with audience <code>api://AzureADTokenExchange</code> and issuer{" "}
                <code>https://login.microsoftonline.com/&lt;Porter-tenant-id&gt;/v2.0</code>).
              </p>
            </div>
          )}
        </div>
        <Field
          label="Enable export"
          hint="When off, validated uploads are not exported (left as NOT_EXPORTED)."
        >
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={draft?.enabled ?? false}
              onChange={(e) => draft && setDraft({ ...draft, enabled: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Export validated uploads to the warehouse
          </label>
        </Field>
        <Field
          label="Storage account URL"
          hint="The external warehouse account, e.g. https://datawarehouse.blob.core.windows.net/"
        >
          <input
            type="text"
            value={draft?.accountUrl ?? ""}
            onChange={setText("accountUrl")}
            placeholder="https://<account>.blob.core.windows.net/"
            className={inputCls}
          />
        </Field>
        <Field
          label="Tenant ID"
          hint="Entra tenant of the data team's app that Porter federates into."
        >
          <input
            type="text"
            value={draft?.tenantId ?? ""}
            onChange={setText("tenantId")}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className={inputCls}
          />
        </Field>
        <Field
          label="Client ID"
          hint="Application (client) ID of the data team's federated app, granted Storage Blob Data Contributor on the container."
        >
          <input
            type="text"
            value={draft?.clientId ?? ""}
            onChange={setText("clientId")}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className={inputCls}
          />
        </Field>
        <Field
          label="Container name"
          hint="The destination container in the external warehouse storage account."
        >
          <input
            type="text"
            value={draft?.container ?? ""}
            onChange={setText("container")}
            placeholder="data-warehouse"
            className={inputCls}
          />
        </Field>
        <Field
          label="Root path"
          hint="Prefix within the container. Files are written to {rootPath}/{schema}/dt=YYYY-MM-DD/{uploadId}.parquet. Leave blank for the container root."
        >
          <input
            type="text"
            value={draft?.rootPath ?? ""}
            onChange={setText("rootPath")}
            placeholder="porter/bronze"
            className={inputCls}
          />
        </Field>
        <Feedback value={feedback} />
        <div>
          <button type="submit" disabled={saving || !draft} className={saveBtnCls}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Security policy section ───────────────────────────────────────────────────

type SecuritySettings = {
  // Session controls
  absoluteSessionTimeoutHours: number;
  maxConcurrentSessions:       number;
  // Password complexity
  passwordMinLength:           number;
  passwordMinClasses:          number;
  passwordCustomDictionary:    string;
  // Password lifecycle
  passwordExpiryDays:          number;
  passwordMinAgeHours:         number;
  passwordHistoryCount:        number;
};

function SecuritySection() {
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [draft, setDraft]       = useState<SecuritySettings | null>(null);
  const [saving, setSaving]     = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/security")
      .then((r) => r.json())
      .then((data: SecuritySettings) => { setSettings(data); setDraft(data); });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch("/api/admin/security", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const updated = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, message: typeof updated.error === "string" ? updated.error : "Failed to save settings." });
        return;
      }
      setSettings(updated);
      setDraft(updated);
      setFeedback({ ok: true, message: "Security settings saved." });
    } catch {
      setFeedback({ ok: false, message: "An error occurred while saving." });
    } finally {
      setSaving(false);
    }
  }

  const setNum = (k: keyof SecuritySettings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!draft) return;
    const n = parseInt(e.target.value, 10);
    setDraft({ ...draft, [k]: isNaN(n) || n < 0 ? 0 : n });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
      <SectionHeader
        title="Security Policy"
        description="Password requirements, session limits, and lifecycle controls. Changes take effect on the next sign-in or password change."
      />
      <form onSubmit={handleSave} className="px-6 py-5 space-y-8">

        {/* ── Session controls ── */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Session</h3>
          <Field
            label="Absolute session timeout (hours)"
            hint="Hard maximum session age regardless of activity. Default: 8 hours. 0 = disabled (not recommended)."
          >
            <input
              type="number" min={0}
              value={draft?.absoluteSessionTimeoutHours ?? 8}
              onChange={setNum("absoluteSessionTimeoutHours")}
              className={inputCls}
            />
          </Field>
          <Field
            label="Max concurrent sessions per user"
            hint="When a new login exceeds this limit, the oldest session is invalidated. 0 = unlimited."
          >
            <input
              type="number" min={0}
              value={draft?.maxConcurrentSessions ?? 0}
              onChange={setNum("maxConcurrentSessions")}
              className={inputCls}
            />
          </Field>
        </div>

        {/* ── Password complexity ── */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Password Complexity</h3>
          <Field
            label="Minimum password length"
            hint="Minimum number of characters required. Default: 15. Must be at least 8."
          >
            <input
              type="number" min={8}
              value={draft?.passwordMinLength ?? 15}
              onChange={setNum("passwordMinLength")}
              className={inputCls}
            />
          </Field>
          <Field
            label="Minimum character classes (1–4)"
            hint="How many of the four classes (uppercase, lowercase, digit, special) must appear. Default: 3."
          >
            <input
              type="number" min={1} max={4}
              value={draft?.passwordMinClasses ?? 3}
              onChange={setNum("passwordMinClasses")}
              className={inputCls}
            />
          </Field>
          <Field
            label="Custom forbidden words"
            hint="One word per line. Passwords containing any of these words (case-insensitive) will be rejected. These supplement the built-in common-password list."
          >
            <textarea
              rows={4}
              value={draft?.passwordCustomDictionary ?? ""}
              onChange={(e) => draft && setDraft({ ...draft, passwordCustomDictionary: e.target.value })}
              placeholder={"companyname\nproductname\nteamname"}
              className={`${inputCls} font-mono text-xs resize-y`}
            />
          </Field>
        </div>

        {/* ── Password lifecycle ── */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Password Lifecycle</h3>
          <Field
            label="Maximum password age (days)"
            hint="Force PASSWORD-method users to change their password after this many days. 0 = never expire."
          >
            <input
              type="number" min={0}
              value={draft?.passwordExpiryDays ?? 0}
              onChange={setNum("passwordExpiryDays")}
              className={inputCls}
            />
          </Field>
          <Field
            label="Minimum password age (hours)"
            hint="Prevent password changes until the current password is at least this old (stops cycling through passwords to get back to a favourite). Does not apply to admin-triggered resets. 0 = no minimum."
          >
            <input
              type="number" min={0}
              value={draft?.passwordMinAgeHours ?? 0}
              onChange={setNum("passwordMinAgeHours")}
              className={inputCls}
            />
          </Field>
          <Field
            label="Password history (last N)"
            hint="Prevent reuse of the last N passwords. 0 = no history check. Maximum 24."
          >
            <input
              type="number" min={0} max={24}
              value={draft?.passwordHistoryCount ?? 0}
              onChange={setNum("passwordHistoryCount")}
              className={inputCls}
            />
          </Field>
        </div>

        <Feedback value={feedback} />
        <div>
          <button type="submit" disabled={saving || !draft} className={saveBtnCls}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Upload schedules section ──────────────────────────────────────────────────

type ScheduleRunResult = {
  ranAt: string;
  schedulesChecked: number;
  remindersSent: number;
  overdueSent: number;
};

function UploadSchedulesSection() {
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [lastRun, setLastRun] = useState<ScheduleRunResult | null>(null);

  async function handleRunNow() {
    setRunning(true);
    setFeedback(null);
    try {
      const res = await apiFetch("/api/admin/schedules/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, message: "Schedule run failed." });
        return;
      }
      setLastRun(data);
      setFeedback({
        ok: true,
        message: `Checked ${data.schedulesChecked} schedule(s): ${data.remindersSent} reminder(s), ${data.overdueSent} overdue notice(s) sent.`,
      });
    } catch {
      setFeedback({ ok: false, message: "An error occurred while running schedules." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
      <SectionHeader
        title="Upload Schedules"
        description="Per-project upload cadences and their reminder/overdue emails are configured on each project (Projects → Schedule). They run daily via a scheduled job; trigger a check manually below."
      />
      <div className="px-6 py-5 space-y-3">
        <Feedback value={feedback} />
        <button
          type="button"
          onClick={handleRunNow}
          disabled={running}
          className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {running ? "Running…" : "Run schedule check now"}
        </button>
        {lastRun && (
          <p className="text-xs text-gray-500">
            Last run at {new Date(lastRun.ranAt).toLocaleString()}:
            {" "}{lastRun.schedulesChecked} checked,
            {" "}{lastRun.remindersSent} reminder(s),
            {" "}{lastRun.overdueSent} overdue notice(s).
          </p>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure application integrations.
        </p>
      </div>
      <SecuritySection />
      <WarehouseExportSection />
      <RetentionSection />
      <UploadSchedulesSection />
    </div>
  );
}
