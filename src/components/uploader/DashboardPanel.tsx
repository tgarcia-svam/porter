"use client";

import { useEffect, useState } from "react";
import Spinner from "@/components/Spinner";
import VisualizationGrid, { type Visualization } from "@/components/VisualizationGrid";

type DashboardData = {
  hasData: boolean;
  visualizations: Visualization[];
};

export default function DashboardPanel({ schemaId, projectId }: { schemaId: string; projectId: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/api/dashboard?schemaId=${schemaId}&projectId=${projectId}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [schemaId, projectId]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 flex flex-col items-center justify-center gap-3">
        <Spinner size="lg" label="Loading dashboard" />
        <p className="text-sm text-gray-500">Loading dashboard…</p>
      </div>
    );
  }

  const visualizations = data?.visualizations ?? [];

  if (visualizations.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center text-sm text-gray-500">
        No visualizations have been configured for this file format yet.
      </div>
    );
  }

  if (!data?.hasData) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center text-sm text-gray-500">
        No valid data has been uploaded yet. Upload a valid file to populate the dashboard.
      </div>
    );
  }

  return <VisualizationGrid visualizations={visualizations} />;
}
