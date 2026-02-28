"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type OrgRef = { id: string; name: string };
type SchemaRef = { id: string; name: string };

type Project = {
  id: string;
  name: string;
  description: string | null;
  _count: { schemas: number };
  organizations: { organization: OrgRef }[];
  schemas: { schema: SchemaRef }[];
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

  async function refresh() {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(await res.json());
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAdding(true);
    try {
      const res = await fetch("/api/projects", {
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
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    await refresh();
    router.refresh();
  }

  async function toggleOrg(projectId: string, orgId: string, assigned: boolean) {
    if (assigned) {
      await fetch(`/api/projects/${projectId}/organizations?organizationId=${orgId}`, {
        method: "DELETE",
      });
    } else {
      await fetch(`/api/projects/${projectId}/organizations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      });
    }
    await refresh();
  }

  async function toggleSchema(projectId: string, schemaId: string, assigned: boolean) {
    if (assigned) {
      await fetch(`/api/projects/${projectId}/schemas?schemaId=${schemaId}`, {
        method: "DELETE",
      });
    } else {
      await fetch(`/api/projects/${projectId}/schemas`, {
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
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={adding || !newName.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {adding ? "Adding…" : "Add"}
            </button>
          </div>
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </form>
        {addError && <p className="mt-2 text-sm text-red-600">{addError}</p>}
      </div>

      {/* Projects list */}
      {projects.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-gray-400 text-sm">No projects yet. Add one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => {
            const assignedOrgIds = new Set(project.organizations.map((o) => o.organization.id));
            const assignedSchemaIds = new Set(project.schemas.map((s) => s.schema.id));
            const isOrgExpanded = expandedOrgId === project.id;
            const isSchemaExpanded = expandedSchemaId === project.id;

            return (
              <div key={project.id} className="bg-white rounded-xl border border-gray-200">
                {/* Project header */}
                <div className="flex items-start gap-3 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">{project.name}</span>
                      <span className="text-xs text-gray-400">
                        {project._count.schemas} {project._count.schemas === 1 ? "schema" : "schemas"}
                      </span>
                    </div>
                    {project.description && (
                      <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">{project.description}</p>
                    )}
                    {/* Org badges */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {project.organizations.length === 0 ? (
                        <span className="text-xs text-gray-400 italic">No organizations assigned</span>
                      ) : (
                        project.organizations.map((o) => (
                          <span
                            key={o.organization.id}
                            className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20"
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
                  </div>

                  <div className="shrink-0 flex items-center gap-3">
                    {allSchemas.length > 0 && (
                      <button
                        onClick={() => {
                          setExpandedSchemaId(isSchemaExpanded ? null : project.id);
                          setExpandedOrgId(null);
                        }}
                        className="text-xs text-purple-600 hover:underline font-medium"
                      >
                        {isSchemaExpanded ? "Done" : "Assign schemas"}
                      </button>
                    )}
                    {allOrganizations.length > 0 && (
                      <button
                        onClick={() => {
                          setExpandedOrgId(isOrgExpanded ? null : project.id);
                          setExpandedSchemaId(null);
                        }}
                        className="text-xs text-blue-600 hover:underline font-medium"
                      >
                        {isOrgExpanded ? "Done" : "Assign orgs"}
                      </button>
                    )}
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
                      Schemas in this project
                    </p>
                    {allSchemas.length === 0 ? (
                      <p className="text-xs text-gray-400">No schemas defined yet.</p>
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
                              className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-xs text-gray-700 truncate">{org.name}</span>
                          </label>
                        );
                      })}
                    </div>
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
