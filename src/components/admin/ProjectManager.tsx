"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";
import { describeSchedule } from "@/lib/upload-schedule";

type OrgRef = { id: string; name: string };
type SchemaRef = { id: string; name: string };

type ScheduleFrequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

type Schedule = {
  id: string;
  projectId: string;
  frequency: ScheduleFrequency;
  weekday: number | null;
  dayOfMonth: number | null;
  monthOfQuarter: number | null;
  monthOfYear: number | null;
  reminderEnabled: boolean;
  reminderDaysBefore: number | null;
  overdueEnabled: boolean;
};

type Project = {
  id: string;
  name: string;
  description: string | null;
  _count: { schemas: number };
  organizations: { organization: OrgRef }[];
  schemas: { schema: SchemaRef }[];
  schedule: Schedule | null;
};

export default function ProjectManager({
  initialProjects,
  allOrganizations,
  allSchemas,
}: {
  initialProjects: Project[];
  allOrganizations: OrgRef[];
  allSchemas: SchemaRef[];
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [expandedSchemaId, setExpandedSchemaId] = useState<string | null>(null);
  const [expandedScheduleId, setExpandedScheduleId] = useState<string | null>(null);
  const [expandedResourceId, setExpandedResourceId] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(await res.json());
  }

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddError(null);
    setAdding(true);
    try {
      const res = await apiFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to add project");
      }
      setNewName("");
      setNewDesc("");
      await refresh();
      router.refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add project");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete project "${name}"? Schemas in this project will be unassigned.`)) return;
    await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
    await refresh();
    router.refresh();
  }

  async function toggleOrg(projectId: string, orgId: string, assigned: boolean) {
    if (assigned) {
      await apiFetch(`/api/projects/${projectId}/organizations?organizationId=${orgId}`, {
        method: "DELETE",
      });
    } else {
      await apiFetch(`/api/projects/${projectId}/organizations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      });
    }
    await refresh();
  }

  async function toggleSchema(projectId: string, schemaId: string, assigned: boolean) {
    if (assigned) {
      await apiFetch(`/api/projects/${projectId}/schemas?schemaId=${schemaId}`, {
        method: "DELETE",
      });
    } else {
      await apiFetch(`/api/projects/${projectId}/schemas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaId }),
      });
    }
    await refresh();
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Add project</h2>
        <form onSubmit={handleAdd} className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              required
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              type="submit"
              disabled={adding || !newName.trim()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {adding ? "Adding…" : "Add"}
            </button>
          </div>
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </form>
        {addError && <p className="mt-2 text-sm text-red-600">{addError}</p>}
      </div>

      {/* Projects list */}
      {projects.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-gray-500 text-sm">No projects yet. Add one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => {
            const assignedOrgIds = new Set(project.organizations.map((o) => o.organization.id));
            const assignedSchemaIds = new Set(project.schemas.map((s) => s.schema.id));
            const isOrgExpanded = expandedOrgId === project.id;
            const isSchemaExpanded = expandedSchemaId === project.id;
            const isScheduleExpanded = expandedScheduleId === project.id;
            const isResourceExpanded = expandedResourceId === project.id;

            return (
              <div key={project.id} className="bg-white rounded-xl border border-gray-200">
                {/* Project header */}
                <div className="flex items-start gap-3 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">{project.name}</span>
                      <span className="text-xs text-gray-500">
                        {project._count.schemas} {project._count.schemas === 1 ? "file format" : "file formats"}
                      </span>
                    </div>
                    {project.description && (
                      <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">{project.description}</p>
                    )}
                    {/* Org badges */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {project.organizations.length === 0 ? (
                        <span className="text-xs text-gray-500 italic">No organizations assigned</span>
                      ) : (
                        project.organizations.map((o) => (
                          <span
                            key={o.organization.id}
                            className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-600/20"
                          >
                            {o.organization.name}
                          </span>
                        ))
                      )}
                    </div>
                    {/* Schema badges */}
                    {project.schemas.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {project.schemas.map((s) => (
                          <span
                            key={s.schema.id}
                            className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-600/20"
                          >
                            {s.schema.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Schedule badge */}
                    {project.schedule && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                          📅 {describeSchedule(project.schedule)}
                        </span>
                        {project.schedule.reminderEnabled && (
                          <span className="text-xs text-gray-400">
                            reminder {project.schedule.reminderDaysBefore}d before
                          </span>
                        )}
                        {project.schedule.overdueEnabled && (
                          <span className="text-xs text-gray-400">· overdue on</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="shrink-0 flex items-center gap-3">
                    {allSchemas.length > 0 && (
                      <button
                        onClick={() => {
                          setExpandedSchemaId(isSchemaExpanded ? null : project.id);
                          setExpandedOrgId(null);
                          setExpandedScheduleId(null);
                          setExpandedResourceId(null);
                        }}
                        className="text-xs text-purple-600 hover:underline font-medium"
                      >
                        {isSchemaExpanded ? "Done" : "Assign file formats"}
                      </button>
                    )}
                    {allOrganizations.length > 0 && (
                      <button
                        onClick={() => {
                          setExpandedOrgId(isOrgExpanded ? null : project.id);
                          setExpandedSchemaId(null);
                          setExpandedScheduleId(null);
                          setExpandedResourceId(null);
                        }}
                        className="text-xs text-brand-600 hover:underline font-medium"
                      >
                        {isOrgExpanded ? "Done" : "Assign orgs"}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setExpandedScheduleId(isScheduleExpanded ? null : project.id);
                        setExpandedOrgId(null);
                        setExpandedSchemaId(null);
                        setExpandedResourceId(null);
                      }}
                      className="text-xs text-amber-600 hover:underline font-medium"
                    >
                      {isScheduleExpanded ? "Done" : "Schedule"}
                    </button>
                    <button
                      onClick={() => {
                        setExpandedResourceId(isResourceExpanded ? null : project.id);
                        setExpandedOrgId(null);
                        setExpandedSchemaId(null);
                        setExpandedScheduleId(null);
                      }}
                      className="text-xs text-teal-600 hover:underline font-medium"
                    >
                      {isResourceExpanded ? "Done" : "Files"}
                    </button>
                    <button
                      onClick={() => handleDelete(project.id, project.name)}
                      className="text-xs text-red-500 hover:underline font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Schema assignment panel */}
                {isSchemaExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4">
                    <p className="text-xs font-medium text-gray-500 mb-3">
                      File formats in this project
                    </p>
                    {allSchemas.length === 0 ? (
                      <p className="text-xs text-gray-500">No file formats defined yet.</p>
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
                                onChange={() => toggleSchema(project.id, schema.id, assigned)}
                                className="h-3.5 w-3.5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                              />
                              <span className="text-xs text-gray-700 truncate">{schema.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Org assignment panel */}
                {isOrgExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4">
                    <p className="text-xs font-medium text-gray-500 mb-3">
                      Organizations in this project
                    </p>
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
                              onChange={() => toggleOrg(project.id, org.id, assigned)}
                              className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                            />
                            <span className="text-xs text-gray-700 truncate">{org.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Schedule panel */}
                {isScheduleExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4">
                    <ScheduleEditor
                      project={project}
                      onSaved={async () => {
                        await refresh();
                        router.refresh();
                      }}
                    />
                  </div>
                )}

                {/* Resources panel */}
                {isResourceExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4">
                    <ResourcePanel project={project} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ResourceRef = {
  id: string;
  fileName: string;
  filePath: string | null;
  contentType: string | null;
  organizationIds: string[];
  createdAt: string;
};

function normalizeResPath(p: string | null | undefined): string {
  return (p ?? "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "").trim();
}

function ResourcePanel({ project }: { project: Project }) {
  const [resources, setResources] = useState<ResourceRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [filePath, setFilePath] = useState("");
  const [selectedOrgIds, setSelectedOrgIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectOrgs = project.organizations.map((o) => o.organization);

  useEffect(() => {
    fetch(`/api/projects/${project.id}/resources`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setResources)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [project.id]);

  const { filesAtLevel, subfolders } = useMemo(() => {
    const filesAtLevel: ResourceRef[] = [];
    const subfolderSet = new Set<string>();
    for (const r of resources) {
      const rPath = normalizeResPath(r.filePath);
      if (rPath === currentPath) {
        filesAtLevel.push(r);
      } else if (currentPath === "" && rPath !== "") {
        subfolderSet.add(rPath.split("/")[0]);
      } else if (currentPath !== "" && rPath.startsWith(currentPath + "/")) {
        const remaining = rPath.slice(currentPath.length + 1);
        subfolderSet.add(remaining.split("/")[0]);
      }
    }
    return { filesAtLevel, subfolders: [...subfolderSet].sort() };
  }, [resources, currentPath]);

  const breadcrumbs = useMemo(
    () => (currentPath ? currentPath.split("/") : []),
    [currentPath]
  );

  function navigateTo(path: string) {
    setCurrentPath(path);
    setFilePath(path);
  }

  function toggleOrg(orgId: string) {
    setSelectedOrgIds((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  }

  function describeScope(orgIds: string[]): string {
    if (orgIds.length === 0) return "All orgs";
    return orgIds.map((id) => projectOrgs.find((o) => o.id === id)?.name ?? id).join(", ");
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedFile) return;
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      fd.append("organizationIds", JSON.stringify([...selectedOrgIds]));
      fd.append("filePath", filePath.trim());
      const res = await apiFetch(`/api/projects/${project.id}/resources`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Upload failed");
      }
      const created: ResourceRef = await res.json();
      setResources((prev) =>
        [...prev, created].sort(
          (a, b) =>
            normalizeResPath(a.filePath).localeCompare(normalizeResPath(b.filePath)) ||
            a.fileName.localeCompare(b.fileName)
        )
      );
      setSelectedFile(null);
      setSelectedOrgIds(new Set());
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    // Optimistic: remove immediately, restore on failure
    setResources((prev) => prev.filter((r) => r.id !== id));
    setConfirmDeleteId(null);
    const res = await apiFetch(`/api/projects/${project.id}/resources/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      // Restore the list from the server
      fetch(`/api/projects/${project.id}/resources`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (data) setResources(data); })
        .catch(() => {});
    }
  }

  return (
    <div className="space-y-3">
      {/* Directory browser */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-sm">
          <button
            onClick={() => navigateTo("")}
            className={currentPath === "" ? "font-medium text-gray-700" : "text-teal-600 hover:underline"}
          >
            Files
          </button>
          {breadcrumbs.map((segment, i) => {
            const path = breadcrumbs.slice(0, i + 1).join("/");
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={path} className="flex items-center gap-1">
                <span className="text-gray-300">/</span>
                {isLast ? (
                  <span className="font-medium text-gray-700">{segment}</span>
                ) : (
                  <button onClick={() => navigateTo(path)} className="text-teal-600 hover:underline">
                    {segment}
                  </button>
                )}
              </span>
            );
          })}
        </div>

        {/* Contents */}
        {loading ? (
          <div className="px-4 py-6 text-xs text-gray-400">Loading…</div>
        ) : subfolders.length === 0 && filesAtLevel.length === 0 ? (
          <div className="px-4 py-6 text-xs text-gray-400 italic">
            {resources.length === 0 ? "No files uploaded yet." : "This folder is empty."}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {/* Folders */}
            {subfolders.map((folder) => {
              const targetPath = currentPath ? `${currentPath}/${folder}` : folder;
              return (
                <button
                  key={folder}
                  onClick={() => navigateTo(targetPath)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors group"
                >
                  <AdminFolderIcon />
                  <span className="flex-1 text-gray-800 font-medium group-hover:text-teal-700">{folder}</span>
                  <AdminChevronIcon />
                </button>
              );
            })}

            {/* Files */}
            {filesAtLevel.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <AdminFileIcon contentType={r.contentType} />
                <span className="flex-1 text-sm text-gray-700 truncate">{r.fileName}</span>
                <span className="shrink-0 text-xs text-gray-400">{describeScope(r.organizationIds)}</span>
                {confirmDeleteId === r.id ? (
                  <span className="flex items-center gap-1.5 shrink-0 ml-2">
                    <span className="text-xs text-gray-500">Delete?</span>
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="text-xs text-red-600 font-medium hover:underline"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-gray-400 hover:underline"
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(r.id)}
                    className="shrink-0 text-xs text-red-500 hover:underline ml-2"
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload form */}
      <form onSubmit={handleUpload} className="rounded-xl border border-gray-200 px-4 py-3 space-y-2 bg-gray-50">
        <p className="text-xs font-medium text-gray-500">Upload to this folder</p>

        <div className="flex gap-2">
          <label className="flex-1 flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 cursor-pointer hover:bg-gray-50">
            <span className="text-xs text-gray-500 truncate flex-1">
              {selectedFile ? selectedFile.name : "Choose file…"}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="submit"
            disabled={uploading || !selectedFile}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>

        <input
          type="text"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="Folder path (leave blank for root)"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
        />

        {projectOrgs.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600">Visible to</span>
              <div className="flex gap-3">
                <button type="button" onClick={() => setSelectedOrgIds(new Set(projectOrgs.map((o) => o.id)))} className="text-xs text-teal-600 hover:underline">All</button>
                <button type="button" onClick={() => setSelectedOrgIds(new Set())} className="text-xs text-gray-400 hover:underline">None</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {projectOrgs.map((org) => (
                <label key={org.id} className="flex items-center gap-2 cursor-pointer rounded px-2 py-1 hover:bg-white">
                  <input
                    type="checkbox"
                    checked={selectedOrgIds.has(org.id)}
                    onChange={() => toggleOrg(org.id)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-xs text-gray-700 truncate">{org.name}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400 italic">
              {selectedOrgIds.size === 0
                ? "Visible to all organizations on this project"
                : `Restricted to ${selectedOrgIds.size} org${selectedOrgIds.size !== 1 ? "s" : ""}`}
            </p>
          </div>
        )}

        {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
      </form>
    </div>
  );
}

function AdminFolderIcon() {
  return (
    <svg className="w-4 h-4 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  );
}

function AdminChevronIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function AdminFileIcon({ contentType }: { contentType: string | null }) {
  const ct = contentType ?? "";
  let color = "text-gray-400";
  if (ct.includes("pdf")) color = "text-red-400";
  else if (ct.includes("spreadsheet") || ct.includes("excel") || ct.includes("csv")) color = "text-green-500";
  else if (ct.includes("word") || ct.includes("document")) color = "text-blue-400";
  else if (ct.includes("image")) color = "text-purple-400";
  return (
    <svg className={`w-4 h-4 shrink-0 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function ScheduleEditor({ project, onSaved }: { project: Project; onSaved: () => Promise<void> }) {
  const s = project.schedule;
  const [frequency, setFrequency] = useState<ScheduleFrequency>(s?.frequency ?? "MONTHLY");
  const [weekday, setWeekday] = useState<number>(s?.weekday ?? 0);
  const [dayOfMonth, setDayOfMonth] = useState<number>(s?.dayOfMonth ?? 1);
  const [monthOfQuarter, setMonthOfQuarter] = useState<number>(s?.monthOfQuarter ?? 1);
  const [monthOfYear, setMonthOfYear] = useState<number>(s?.monthOfYear ?? 1);
  const [reminderEnabled, setReminderEnabled] = useState<boolean>(s?.reminderEnabled ?? false);
  const [reminderDaysBefore, setReminderDaysBefore] = useState<number>(s?.reminderDaysBefore ?? 3);
  const [overdueEnabled, setOverdueEnabled] = useState<boolean>(s?.overdueEnabled ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextDue, setNextDue] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; skipped: number } | null>(null);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const body = {
        frequency,
        weekday: frequency === "WEEKLY" ? weekday : null,
        dayOfMonth: frequency === "WEEKLY" ? null : dayOfMonth,
        monthOfQuarter: frequency === "QUARTERLY" ? monthOfQuarter : null,
        monthOfYear: frequency === "YEARLY" ? monthOfYear : null,
        reminderEnabled,
        reminderDaysBefore: reminderEnabled ? reminderDaysBefore : null,
        overdueEnabled,
      };
      const res = await apiFetch(`/api/projects/${project.id}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Failed to save schedule");
      }
      const saved = await res.json();
      setNextDue(saved.nextDueDate ?? null);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  }

  async function handleSendNow() {
    setSending(true);
    setSendResult(null);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/schedule/notify`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Failed to send reminders");
      }
      const data = await res.json();
      setSendResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reminders");
    } finally {
      setSending(false);
    }
  }

  async function handleRemove() {
    if (!confirm("Remove the upload schedule for this project? No further reminders will be sent.")) return;
    setSaving(true);
    try {
      await apiFetch(`/api/projects/${project.id}/schedule`, { method: "DELETE" });
      setNextDue(null);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    "rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-gray-500">
        Upload cadence — each organization must submit a valid file for every file format in this
        project by the due date.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-gray-600">Frequency</label>
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)}
          className={fieldClass}
        >
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="QUARTERLY">Quarterly</option>
          <option value="YEARLY">Yearly</option>
        </select>

        {frequency === "WEEKLY" && (
          <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={fieldClass}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
        )}

        {frequency === "MONTHLY" && (
          <label className="flex items-center gap-1 text-xs text-gray-600">
            Day
            <input
              type="number" min={1} max={31} value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Number(e.target.value))}
              className={`${fieldClass} w-20`}
            />
            <span className="text-gray-400">(clamped to month length)</span>
          </label>
        )}

        {frequency === "QUARTERLY" && (
          <>
            <select value={monthOfQuarter} onChange={(e) => setMonthOfQuarter(Number(e.target.value))} className={fieldClass}>
              <option value={1}>1st month of quarter</option>
              <option value={2}>2nd month of quarter</option>
              <option value={3}>3rd month of quarter</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-600">
              Day
              <input
                type="number" min={1} max={31} value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
                className={`${fieldClass} w-20`}
              />
            </label>
          </>
        )}

        {frequency === "YEARLY" && (
          <>
            <select value={monthOfYear} onChange={(e) => setMonthOfYear(Number(e.target.value))} className={fieldClass}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-600">
              Day
              <input
                type="number" min={1} max={31} value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
                className={`${fieldClass} w-20`}
              />
            </label>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox" checked={reminderEnabled}
            onChange={(e) => setReminderEnabled(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
          />
          Send reminder
        </label>
        {reminderEnabled && (
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input
              type="number" min={1} max={365} value={reminderDaysBefore}
              onChange={(e) => setReminderDaysBefore(Number(e.target.value))}
              className={`${fieldClass} w-20`}
            />
            days before due
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox" checked={overdueEnabled}
            onChange={(e) => setOverdueEnabled(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
          />
          Send overdue notice
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {nextDue && <p className="text-xs text-gray-500">Next due date: <strong>{nextDue}</strong></p>}
      {sendResult && (
        <p className="text-xs text-green-700">
          Reminders sent: <strong>{sendResult.sent}</strong>
          {sendResult.skipped > 0 && (
            <span className="text-gray-500"> ({sendResult.skipped} org{sendResult.skipped !== 1 ? "s" : ""} already up to date)</span>
          )}
          {sendResult.sent === 0 && sendResult.skipped === 0 && (
            <span className="text-gray-500"> — no organizations assigned to this project</span>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : s ? "Update schedule" : "Set schedule"}
        </button>
        {s && (
          <>
            <button
              onClick={handleSendNow}
              disabled={sending || saving}
              className="rounded-lg border border-amber-600 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition-colors"
            >
              {sending ? "Sending…" : "Send Reminder Now"}
            </button>
            <button
              onClick={handleRemove}
              disabled={saving}
              className="text-xs text-red-500 hover:underline font-medium"
            >
              Remove schedule
            </button>
          </>
        )}
      </div>
    </div>
  );
}
