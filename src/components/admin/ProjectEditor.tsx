"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";
import {
  ScheduleEditor,
  ResourcePanel,
  type OrgRef,
  type SchemaRef,
  type Project,
} from "@/components/admin/ProjectManager";

export default function ProjectEditor({
  initialProject,
  allOrganizations,
  allSchemas,
}: {
  initialProject: Project;
  allOrganizations: OrgRef[];
  allSchemas: SchemaRef[];
}) {
  const router = useRouter();

  // Details — auto-saves on blur when the value has changed
  const [name, setName] = useState(initialProject.name);
  const [description, setDescription] = useState(initialProject.description ?? "");
  const savedName = useRef(initialProject.name);
  const savedDescription = useRef(initialProject.description ?? "");
  const [detailsStatus, setDetailsStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Assignment sets — kept in local state so checkboxes respond immediately
  const [assignedOrgIds, setAssignedOrgIds] = useState<Set<string>>(
    () => new Set(initialProject.organizations.map((o) => o.organization.id))
  );
  const [assignedSchemaIds, setAssignedSchemaIds] = useState<Set<string>>(
    () => new Set(initialProject.schemas.map((s) => s.schema.id))
  );

  // Derive current org list from assignedOrgIds so ResourcePanel / ScheduleEditor
  // reflect newly assigned orgs without a full page reload.
  const currentOrgList = allOrganizations
    .filter((org) => assignedOrgIds.has(org.id))
    .map((org) => ({ organization: org }));

  const projectForSubcomponents: Project = {
    ...initialProject,
    organizations: currentOrgList,
  };

  async function saveDetails(currentName: string, currentDescription: string) {
    const trimmedName = currentName.trim();
    const trimmedDesc = currentDescription.trim();
    if (!trimmedName) return;
    if (trimmedName === savedName.current && trimmedDesc === savedDescription.current) return;
    setDetailsStatus("saving");
    setDetailsError(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      const res = await apiFetch(`/api/projects/${initialProject.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, description: trimmedDesc || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save");
      }
      savedName.current = trimmedName;
      savedDescription.current = trimmedDesc;
      setDetailsStatus("saved");
      router.refresh();
      saveTimer.current = setTimeout(() => setDetailsStatus("idle"), 2000);
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : "Failed to save");
      setDetailsStatus("error");
    }
  }

  async function toggleOrg(orgId: string) {
    const assigned = assignedOrgIds.has(orgId);
    setAssignedOrgIds((prev) => {
      const next = new Set(prev);
      if (assigned) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
    if (assigned) {
      await apiFetch(
        `/api/projects/${initialProject.id}/organizations?organizationId=${orgId}`,
        { method: "DELETE" }
      );
    } else {
      await apiFetch(`/api/projects/${initialProject.id}/organizations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      });
    }
    router.refresh();
  }

  async function toggleSchema(schemaId: string) {
    const assigned = assignedSchemaIds.has(schemaId);
    setAssignedSchemaIds((prev) => {
      const next = new Set(prev);
      if (assigned) next.delete(schemaId);
      else next.add(schemaId);
      return next;
    });
    if (assigned) {
      await apiFetch(
        `/api/projects/${initialProject.id}/schemas?schemaId=${schemaId}`,
        { method: "DELETE" }
      );
    } else {
      await apiFetch(`/api/projects/${initialProject.id}/schemas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaId }),
      });
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Details */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Details</h2>
          {detailsStatus === "saving" && (
            <span className="text-xs text-gray-400">Saving…</span>
          )}
          {detailsStatus === "saved" && (
            <span className="text-xs text-green-600">Saved</span>
          )}
          {detailsStatus === "error" && (
            <span className="text-xs text-red-600">{detailsError}</span>
          )}
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => saveDetails(name, description)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => saveDetails(name, description)}
              placeholder="Brief description of this project"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>
        </div>
      </div>

      {/* File Formats */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">File Formats</h2>
        <p className="text-xs text-gray-500 mb-4">
          The file formats organizations must submit for this project.
        </p>
        {allSchemas.length === 0 ? (
          <p className="text-xs text-gray-500 italic">No file formats defined yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {allSchemas.map((schema) => {
              const assigned = assignedSchemaIds.has(schema.id);
              return (
                <label
                  key={schema.id}
                  className="flex items-center gap-2 cursor-pointer rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={assigned}
                    onChange={() => toggleSchema(schema.id)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-xs text-gray-700 truncate">{schema.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Organizations */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Organizations</h2>
        <p className="text-xs text-gray-500 mb-4">
          Organizations participating in this project.
        </p>
        {allOrganizations.length === 0 ? (
          <p className="text-xs text-gray-500 italic">No organizations defined yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {allOrganizations.map((org) => {
              const assigned = assignedOrgIds.has(org.id);
              return (
                <label
                  key={org.id}
                  className="flex items-center gap-2 cursor-pointer rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={assigned}
                    onChange={() => toggleOrg(org.id)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-xs text-gray-700 truncate">{org.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Upload Schedule */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Upload Schedule</h2>
        <p className="text-xs text-gray-500 mb-4">
          Set the upload cadence and configure reminder emails.
        </p>
        <ScheduleEditor
          project={projectForSubcomponents}
          onSaved={async () => {
            router.refresh();
          }}
        />
      </div>

      {/* Project Files */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Project Files</h2>
        <p className="text-xs text-gray-500 mb-4">
          Reference files visible to organization users in this project.
        </p>
        <ResourcePanel project={projectForSubcomponents} />
      </div>
    </div>
  );
}
