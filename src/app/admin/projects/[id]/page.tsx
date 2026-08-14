import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import ProjectEditor from "@/components/admin/ProjectEditor";

export const dynamic = "force-dynamic";

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [session, { id }] = await Promise.all([auth(), params]);
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const [project, allOrganizations, allSchemas] = await Promise.all([
    prisma.project.findUnique({
      where: { id },
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
    prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.schema.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!project || project.deletedAt) notFound();

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-6">
      <div>
        <Link
          href="/admin/projects"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <span aria-hidden>←</span> Back to Projects
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">{project.name}</h1>
        {project.description && (
          <p className="mt-1 text-sm text-gray-500">{project.description}</p>
        )}
      </div>
      <ProjectEditor
        initialProject={project}
        allOrganizations={allOrganizations}
        allSchemas={allSchemas}
      />
    </div>
  );
}
