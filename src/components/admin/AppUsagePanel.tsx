"use client";

import RecentUploadsReport from "@/components/admin/RecentUploadsReport";
import OverdueUploadsReport from "@/components/admin/OverdueUploadsReport";

export default function AppUsagePanel() {
  return (
    <div className="space-y-6">
      <RecentUploadsReport />
      <OverdueUploadsReport />
    </div>
  );
}
