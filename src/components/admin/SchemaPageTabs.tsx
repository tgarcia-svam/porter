"use client";

import { useState } from "react";
import Link from "next/link";
import SchemaListClient from "@/components/admin/SchemaListClient";
import ClassificationManager from "@/components/admin/ClassificationManager";

type ClassificationType = "VALUE_LIST" | "REGEX" | "NUMBER_RANGE" | "DATE_RANGE";

type FullClassification = {
  id: string;
  name: string;
  description: string | null;
  type: ClassificationType;
  values: string[];
  caseSensitive: boolean;
  pattern: string | null;
  minNumber: number | null;
  maxNumber: number | null;
  minDate: string | null;
  maxDate: string | null;
  _count: { columns: number };
};

type TabId = "formats" | "classifications";

export default function SchemaPageTabs({
  initialSchemas,
  initialClassifications,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialSchemas: any[];
  initialClassifications: FullClassification[];
}) {
  const [activeTab, setActiveTab] = useState<TabId>("formats");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">File Formats</h1>
          <p className="mt-1 text-sm text-gray-500">
            Define file format requirements for uploaders.
          </p>
        </div>
        {activeTab === "formats" && (
          <Link
            href="/admin/schemas/new"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
          >
            New file format
          </Link>
        )}
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-1">
          {(["formats", "classifications"] as TabId[]).map((tab) => {
            const labels: Record<TabId, string> = {
              formats: "File Formats",
              classifications: "Classifications",
            };
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === "formats" && (
        <SchemaListClient initialSchemas={initialSchemas} />
      )}

      {activeTab === "classifications" && (
        <ClassificationManager initialClassifications={initialClassifications} />
      )}
    </div>
  );
}
