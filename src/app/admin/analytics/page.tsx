import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import AnalyticsTabs from "@/components/admin/AnalyticsTabs";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const projectsRaw = await prisma.project.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    include: {
      schemas: {
        where: { schema: { deletedAt: null } },
        include: { schema: { select: { id: true, name: true } } },
      },
      organizations: {
        where: { organization: { deletedAt: null } },
        include: { organization: { select: { id: true, name: true } } },
      },
    },
  });

  const projects = projectsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    schemas: p.schemas.map((s) => ({ id: s.schema.id, name: s.schema.name })),
    organizations: p.organizations.map((o) => ({ id: o.organization.id, name: o.organization.name })),
  }));

  return (
    <div className="max-w-5xl mx-auto py-10 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
      </div>
      <AnalyticsTabs projects={projects} />
    </div>
  );
}
