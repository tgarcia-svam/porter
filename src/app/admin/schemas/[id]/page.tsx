import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import SchemaEditor from "@/components/admin/SchemaEditor";

export default async function EditSchemaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [schema, allProjects] = await Promise.all([
    prisma.schema.findUnique({
      where: { id },
      include: {
        columns: { orderBy: { order: "asc" } },
        projects: { select: { projectId: true } },
      },
    }),
    prisma.project.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!schema) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Edit Schema</h1>
        <p className="mt-1 text-sm text-gray-500">
          Modify column definitions. Changes apply to all future uploads.
        </p>
      </div>
      <SchemaEditor
        initialData={{
          id: schema.id,
          name: schema.name,
          description: schema.description ?? "",
          projectIds: schema.projects.map((p) => p.projectId),
          columns: schema.columns.map((c) => ({
            name: c.name,
            dataType: c.dataType as "TEXT" | "NUMBER" | "INTEGER" | "BOOLEAN" | "DATE" | "EMAIL",
            required: c.required,
          })),
        }}
        allProjects={allProjects}
      />
    </div>
  );
}
