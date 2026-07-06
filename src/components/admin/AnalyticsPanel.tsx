"use client";

import { useEffect, useRef, useState } from "react";
import Spinner from "@/components/Spinner";
import VisualizationGrid, { type Visualization } from "@/components/VisualizationGrid";

type Ref = { id: string; name: string };
type Project = { id: string; name: string; schemas: Ref[]; organizations: Ref[] };

type AnalyticsData = {
  configured: boolean;
  hasData: boolean;
  visualizations: Visualization[];
};

export default function AnalyticsPanel({ projects }: { projects: Project[] }) {
  // Nothing is pre-selected on load — the dashboard starts empty.
  const [projectId, setProjectId] = useState("");
  const project = projects.find((p) => p.id === projectId) ?? null;

  const [schemaId, setSchemaId] = useState("");
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);

  // Switching project resets the file format (require an explicit pick) and
  // pre-selects all of the new project's providers.
  function onProjectChange(id: string) {
    const next = projects.find((p) => p.id === id);
    setProjectId(id);
    setSchemaId("");
    setSelectedOrgs(next?.organizations.map((o) => o.id) ?? []);
  }

  const orgKey = selectedOrgs.join(",");

  useEffect(() => {
    if (!projectId || !schemaId) {
      setData(null);
      return;
    }
    const params = new URLSearchParams({ projectId, schemaId });
    selectedOrgs.forEach((id) => params.append("orgId", id));

    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/analytics?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // orgKey stands in for the selectedOrgs array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, schemaId, orgKey]);

  const orgs = project?.organizations ?? [];
  const schemas = project?.schemas ?? [];

  return (
    <div className="space-y-6">
      {/* Selectors */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-xs font-medium text-gray-500">Project</span>
            <select
              value={projectId}
              onChange={(e) => onProjectChange(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-gray-500">File Format</span>
            <select
              value={schemaId}
              onChange={(e) => setSchemaId(e.target.value)}
              disabled={!projectId}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="">
                {!projectId
                  ? "Select a project first"
                  : schemas.length === 0
                    ? "No file formats on this project"
                    : "Select a file format…"}
              </option>
              {schemas.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <div className="block">
            <span className="text-xs font-medium text-gray-500">Providers</span>
            <ProviderDropdown
              orgs={orgs}
              selected={selectedOrgs}
              onChange={setSelectedOrgs}
              disabled={!projectId}
            />
          </div>
        </div>
      </div>

      {/* Reports */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 flex flex-col items-center justify-center gap-3">
          <Spinner size="lg" label="Loading reports" />
          <p className="text-sm text-gray-500">Loading reports…</p>
        </div>
      ) : (
        <ReportsBody projectSelected={!!projectId} schemaSelected={!!schemaId} data={data} />
      )}
    </div>
  );
}

/** Multi-select drop-down of providers with a "Select all" option. */
function ProviderDropdown({
  orgs,
  selected,
  onChange,
  disabled,
}: {
  orgs: Ref[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const allRef = useRef<HTMLInputElement>(null);

  const isDisabled = disabled || orgs.length === 0;
  const allSelected = orgs.length > 0 && selected.length === orgs.length;
  const noneSelected = selected.length === 0;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // Partial selection → indeterminate "Select all" checkbox.
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = !noneSelected && !allSelected;
  }, [noneSelected, allSelected]);

  function toggleAll() {
    onChange(allSelected ? [] : orgs.map((o) => o.id));
  }
  function toggleOne(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  const summary = isDisabled
    ? "No providers"
    : allSelected
      ? "All providers"
      : noneSelected
        ? "None selected"
        : `${selected.length} of ${orgs.length} selected`;

  return (
    <div className="relative mt-1" ref={containerRef}>
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md border border-gray-300 px-3 py-2 text-sm text-left disabled:bg-gray-50 disabled:text-gray-400"
      >
        <span className={!isDisabled && noneSelected ? "text-gray-400" : "text-gray-900"}>
          {summary}
        </span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && !isDisabled && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 hover:opacity-80">
              <input
                ref={allRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-3.5 w-3.5"
              />
              <span className="text-sm font-medium text-gray-700">Select all</span>
            </label>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={noneSelected}
              className="text-xs text-gray-500 hover:underline disabled:opacity-40 disabled:no-underline"
            >
              Deselect all
            </button>
          </div>
          {orgs.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={() => toggleOne(o.id)}
                className="h-3.5 w-3.5"
              />
              <span className="text-sm text-gray-700">{o.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center text-sm text-gray-500">
      {children}
    </div>
  );
}

function ReportsBody({
  projectSelected,
  schemaSelected,
  data,
}: {
  projectSelected: boolean;
  schemaSelected: boolean;
  data: AnalyticsData | null;
}) {
  if (!projectSelected || !schemaSelected) {
    return <EmptyCard>Select a project and file format to view its reports.</EmptyCard>;
  }
  if (!data) {
    return <EmptyCard>Could not load reports. Try again.</EmptyCard>;
  }
  if (!data.configured) {
    return (
      <EmptyCard>
        No reports have been configured for this file format yet. Add visualizations in the File
        Format editor.
      </EmptyCard>
    );
  }
  if (!data.hasData || data.visualizations.length === 0) {
    return <EmptyCard>No valid uploads found for the selected providers.</EmptyCard>;
  }
  return <VisualizationGrid visualizations={data.visualizations} />;
}
