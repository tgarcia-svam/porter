"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/apiFetch";

type Column = {
  id: string;
  name: string;
  dataType: string;
  required: boolean;
  order: number;
  classification: { name: string } | null;
};

type Schema = {
  id: string;
  name: string;
  description: string | null;
  columns: Column[];
  projects: { project: { id: string; name: string } }[];
  _count: { uploads: number };
};

export default function SchemaListClient({
  initialSchemas,
}: {
  initialSchemas: Schema[];
}) {
  const router = useRouter();

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete file format "${name}"? This cannot be undone.`)) return;
    await apiFetch(`/api/schemas/${id}`, { method: "DELETE" });
    router.refresh();
  }

  if (initialSchemas.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
        <p className="text-gray-400 text-sm">No file formats yet.</p>
        <Link
          href="/admin/schemas/new"
          className="mt-3 inline-block text-sm text-blue-600 hover:underline"
        >
          Create your first file format →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {initialSchemas.map((schema) => (
        <div
          key={schema.id}
          className="bg-white rounded-xl border border-gray-200 p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 truncate">
                {schema.name}
              </h3>
              {schema.description && (
                <p className="mt-0.5 text-sm text-gray-500 line-clamp-1">
                  {schema.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {schema.projects.map(({ project }) => (
                  <span
                    key={project.id}
                    className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-600/20"
                  >
                    {project.name}
                  </span>
                ))}
                {schema.columns.map((col) => (
                  <span
                    key={col.id}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600"
                  >
                    <span className="font-medium">{col.name}</span>
                    <span className="text-gray-400">{col.dataType}</span>
                    {col.classification && (
                      <span className="rounded-full bg-green-50 px-1.5 text-green-700 ring-1 ring-inset ring-green-600/20">
                        {col.classification.name}
                      </span>
                    )}
                    {col.required && (
                      <span className="text-red-400 font-bold">*</span>
                    )}
                  </span>
                ))}
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-4 text-xs text-gray-400">
              <span>{schema._count.uploads} uploads</span>
              <Link
                href={`/admin/schemas/${schema.id}`}
                className="text-blue-600 hover:underline font-medium"
              >
                Edit
              </Link>
              <button
                onClick={() => handleDelete(schema.id, schema.name)}
                className="text-red-500 hover:underline font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
