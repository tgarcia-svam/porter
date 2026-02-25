"use client";

import { useEffect, useState } from "react";

type SettingSource = "db" | "env" | "default" | null;

type AzureStatus = {
  connectionStringConfigured: boolean;
  connectionStringSource: SettingSource;
  containerName: string;
  containerNameSource: SettingSource;
};

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

export default function SettingsPage() {
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

      if (!res.ok) {
        setFeedback({ ok: false, message: "Failed to save settings." });
        return;
      }

      const updated: AzureStatus = await res.json();
      setStatus(updated);
      setContainerName(updated.containerName);
      setConnectionString("");
      setFeedback({ ok: true, message: "Settings saved successfully." });
    } catch {
      setFeedback({ ok: false, message: "An error occurred while saving." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure application integrations. Database values take priority over environment variables.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        <div className="px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">Azure Blob Storage</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Files uploaded by users are stored in Azure Blob Storage.
          </p>
        </div>

        <form onSubmit={handleSave} className="px-6 py-5 space-y-5">
          {/* Connection String */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label className="block text-sm font-medium text-gray-700">
                Connection String
              </label>
              {status && <SourceBadge source={status.connectionStringSource} />}
            </div>
            <input
              type="password"
              value={connectionString}
              onChange={(e) => setConnectionString(e.target.value)}
              placeholder={
                status?.connectionStringConfigured
                  ? "Enter new value to update (currently configured)"
                  : "DefaultEndpointsProtocol=https;AccountName=..."
              }
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400">
              Leave blank to keep the existing value unchanged.
            </p>
          </div>

          {/* Container Name */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label className="block text-sm font-medium text-gray-700">
                Container Name
              </label>
              {status && <SourceBadge source={status.containerNameSource} />}
            </div>
            <input
              type="text"
              value={containerName}
              onChange={(e) => setContainerName(e.target.value)}
              placeholder="porter-uploads"
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Feedback */}
          {feedback && (
            <p
              className={`text-sm ${feedback.ok ? "text-green-600" : "text-red-600"}`}
            >
              {feedback.message}
            </p>
          )}

          <div>
            <button
              type="submit"
              disabled={saving || !status}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
