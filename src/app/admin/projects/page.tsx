import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import ProjectManager from "@/components/admin/ProjectManager";

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const [projects, allOrganizations, allSchemas] = await Promise.all([
    prisma.project.findMany({
      orderBy: { name: "asc" },
      include: {
        organizations: { include: { organization: true } },
        schemas: { include: { schema: { select: { id: true, name: true } } } },
        _count: { select: { schemas: true } },
      },
    }),
    prisma.organization.findMany({ orderBy: { name: "asc" } }),
    prisma.schema.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage projects. Assign schemas and organizations to projects.
        </p>
      </div>
      <ProjectManager initialProjects={projects} allOrganizations={allOrganizations} allSchemas={allSchemas} />
    </div>
  );
}
