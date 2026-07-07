"use client";

import { useState } from "react";
import RecentUploadsReport from "@/components/admin/RecentUploadsReport";
import OverdueUploadsReport from "@/components/admin/OverdueUploadsReport";

type SubTab = "recent" | "overdue";

const SUB_TABS: { key: SubTab; label: string; description: string }[] = [
  {
    key: "recent",
    label: "Recent Uploads",
    description: "A paginated log of all file submissions across every provider.",
  },
  {
    key: "overdue",
    label: "Overdue Uploads",
    description: "Providers that have missed their scheduled upload deadline.",
  },
];

export default function AppUsagePanel() {
  const [subTab, setSubTab] = useState<SubTab>("recent");
  const active = SUB_TABS.find((t) => t.key === subTab)!;

  return (
    <div className="space-y-4">
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6" aria-label="App usage tabs">
          {SUB_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                subTab === t.key
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

      {subTab === "recent" ? <RecentUploadsReport /> : <OverdueUploadsReport />}
    </div>
  );
}
