"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";

type SettingSource = "db" | "env" | "default" | null;

// ── Types ─────────────────────────────────────────────────────────────────────

type ProviderStatus = {
  configured: boolean;
  clientIdSource: SettingSource;
  clientSecretSource: SettingSource;
};

type SSOStatus = {
  google: ProviderStatus;
  microsoft: ProviderStatus & {
    tenantId: string;
    tenantIdSource: SettingSource;
  };
};

// ── Shared components ─────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: SettingSource }) {
  if (!source) return null;
  const styles: Record<NonNullable<SettingSource>, string> = {
    db: "bg-green-50 text-green-700 ring-green-600/20",
    env: "bg-brand-50 text-brand-700 ring-brand-600/20",
    default: "bg-gray-50 text-gray-600 ring-gray-500/20",
  };
  const labels: Record<NonNullable<SettingSource>, string> = {
    db: "From database",
    env: "From environment",
    default: "Using default",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[source]}`}
    >
      {labels[source]}
    </span>
  );
}

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
  source,
  children,
  hint,
}: {
  label: string;
  source?: SettingSource;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="block text-sm font-medium text-gray-700">{label}</label>
        {source !== undefined && <SourceBadge source={source} />}
      </div>
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

// ── Google SSO section ────────────────────────────────────────────────────────

function GoogleSection() {
  const [status, setStatus] = useState<SSOStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch("/api/settings/sso")
      .then((r) => r.json())
      .then((data: SSOStatus) => setStatus(data));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch("/api/settings/sso", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleClientId: clientId, googleClientSecret: clientSecret }),
      });
      if (!res.ok) { setFeedback({ ok: false, message: "Failed to save settings." }); return; }
      const updated: SSOStatus = await res.json();
      setStatus(updated);
      setClientId("");
      setClientSecret("");
      setFeedback({ ok: true, message: "Google SSO settings saved." });
    } catch {
      setFeedback({ ok: false, message: "An error occurred while saving." });
    } finally {
      setSaving(false);
    }
  }

  const g = status?.google;

  return (
    <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
      <SectionHeader
        title="Google Single Sign-On"
        description="Allow users to sign in with their Google account."
      />
      <form onSubmit={handleSave} className="px-6 py-5 space-y-5">
        <Field
          label="Client ID"
          source={g?.clientIdSource}
          hint="Leave blank to keep the existing value unchanged."
        >
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={
              g?.clientIdSource
                ? "Enter new value to update (currently configured)"
                : "123456789-abc...apps.googleusercontent.com"
            }
            className={inputCls}
          />
        </Field>
        <Field label="Client Secret" source={g?.clientSecretSource}>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={
              g?.clientSecretSource
                ? "Enter new value to update (currently configured)"
                : "GOCSPX-..."
            }
            className={inputCls}
          />
        </Field>
        <Feedback value={feedback} />
        <div>
          <button type="submit" disabled={saving || !status} className={saveBtnCls}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Microsoft SSO section ─────────────────────────────────────────────────────

function MicrosoftSection() {
  const [status, setStatus] = useState<SSOStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch("/api/settings/sso")
      .then((r) => r.json())
      .then((data: SSOStatus) => {
        setStatus(data);
        setTenantId(data.microsoft.tenantId);
      });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch("/api/settings/sso", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msClientId: clientId, msClientSecret: clientSecret, msTenantId: tenantId }),
      });
      if (!res.ok) { setFeedback({ ok: false, message: "Failed to save settings." }); return; }
      const updated: SSOStatus = await res.json();
      setStatus(updated);
      setTenantId(updated.microsoft.tenantId);
      setClientId("");
      setClientSecret("");
      setFeedback({ ok: true, message: "Microsoft SSO settings saved." });
    } catch {
      setFeedback({ ok: false, message: "An error occurred while saving." });
    } finally {
      setSaving(false);
    }
  }

  const ms = status?.microsoft;

  return (
    <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
      <SectionHeader
        title="Microsoft Single Sign-On"
        description="Allow users to sign in with their Microsoft / Entra ID account."
      />
      <form onSubmit={handleSave} className="px-6 py-5 space-y-5">
        <Field
          label="Client ID"
          source={ms?.clientIdSource}
          hint="Leave blank to keep the existing value unchanged."
        >
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={
              ms?.clientIdSource
                ? "Enter new value to update (currently configured)"
                : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            }
            className={inputCls}
          />
        </Field>
        <Field label="Client Secret" source={ms?.clientSecretSource}>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={
              ms?.clientSecretSource
                ? "Enter new value to update (currently configured)"
                : "xxxxxxxx~xxxxxxxx"
            }
            className={inputCls}
          />
        </Field>
        <Field
          label="Tenant ID"
          source={ms?.tenantIdSource}
          hint={'Use "common" to allow any Microsoft account, or enter your directory (tenant) GUID for single-tenant.'}
        >
          <input
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="common"
            className={inputCls}
          />
        </Field>
        <Feedback value={feedback} />
        <div>
          <button type="submit" disabled={saving || !status} className={saveBtnCls}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure application integrations. Database values take priority over
          environment variables.
        </p>
      </div>
      <GoogleSection />
      <MicrosoftSection />
      <WarehouseExportSection />
      <RetentionSection />
    </div>
  );
}
