import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import ProjectManager from "@/components/admin/ProjectManager";

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const [projects, allOrganizations, allSchemas] = await Promise.all([
    prisma.project.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      include: {
        organizations: {
          where: { organization: { deletedAt: null } },
          include: { organization: true },
        },
        schemas: {
          where: { schema: { deletedAt: null } },
          include: { schema: { select: { id: true, name: true } } },
        },
        schedule: true,
        _count: { select: { schemas: true } },
      },
    }),
    prisma.organization.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.schema.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
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
