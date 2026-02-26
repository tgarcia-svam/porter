"use client";

import { useEffect, useState } from "react";

type SettingSource = "db" | "env" | "default" | null;

// ── Types ─────────────────────────────────────────────────────────────────────

type AzureStatus = {
  connectionStringConfigured: boolean;
  connectionStringSource: SettingSource;
  containerName: string;
  containerNameSource: SettingSource;
};

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
    env: "bg-blue-50 text-blue-700 ring-blue-600/20",
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
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
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
  "block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

const saveBtnCls =
  "inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50";

// ── Azure Storage section ─────────────────────────────────────────────────────

function AzureSection() {
  const [status, setStatus] = useState<AzureStatus | null>(null);
  const [connectionString, setConnectionString] = useState("");
  const [containerName, setContainerName] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch("/api/settings/azure")
      .then((r) => r.json())
      .then((data: AzureStatus) => {
        setStatus(data);
        setContainerName(data.containerName);
      });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/settings/azure", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionString, containerName }),
      });
      if (!res.ok) { setFeedback({ ok: false, message: "Failed to save settings." }); return; }
      const updated: AzureStatus = await res.json();
      setStatus(updated);
      setContainerName(updated.containerName);
      setConnectionString("");
      setFeedback({ ok: true, message: "Settings saved." });
    } catch {
      setFeedback({ ok: false, message: "An error occurred while saving." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
      <SectionHeader
        title="Azure Blob Storage"
        description="Files uploaded by users are stored in Azure Blob Storage."
      />
      <form onSubmit={handleSave} className="px-6 py-5 space-y-5">
        <Field
          label="Connection String"
          source={status?.connectionStringSource}
          hint="Leave blank to keep the existing value unchanged."
        >
          <input
            type="password"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
            placeholder={
              status?.connectionStringConfigured
                ? "Enter new value to update (currently configured)"
                : "DefaultEndpointsProtocol=https;AccountName=..."
            }
            className={inputCls}
          />
        </Field>
        <Field label="Container Name" source={status?.containerNameSource}>
          <input
            type="text"
            value={containerName}
            onChange={(e) => setContainerName(e.target.value)}
            placeholder="porter-uploads"
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
      const res = await fetch("/api/settings/sso", {
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
      const res = await fetch("/api/settings/sso", {
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
      <AzureSection />
      <GoogleSection />
      <MicrosoftSection />
    </div>
  );
}
