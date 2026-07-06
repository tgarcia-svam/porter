"use client";

import { useState } from "react";
import AnalyticsPanel from "@/components/admin/AnalyticsPanel";
import AppUsagePanel from "@/components/admin/AppUsagePanel";

type Ref = { id: string; name: string };
type Project = { id: string; name: string; schemas: Ref[]; organizations: Ref[] };

type Tab = "project-data" | "app-usage";

const TABS: { key: Tab; label: string; description: string }[] = [
  {
    key: "project-data",
    label: "Project Data",
    description:
      "Pick a project and file format to view its pre-configured reports. Filter the data by provider.",
  },
  {
    key: "app-usage",
    label: "App Usage",
    description: "Recent upload activity and outstanding overdue obligations across all providers.",
  },
];

export default function AnalyticsTabs({ projects }: { projects: Project[] }) {
  const [tab, setTab] = useState<Tab>("project-data");
  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6" aria-label="Analytics tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-brand-500 text-brand-700"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <p className="text-sm text-gray-500">{active.description}</p>

      {tab === "project-data" ? <AnalyticsPanel projects={projects} /> : <AppUsagePanel />}
    </div>
  );
}
