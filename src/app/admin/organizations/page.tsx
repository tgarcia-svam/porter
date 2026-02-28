import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import OrganizationManager from "@/components/admin/OrganizationManager";

export default async function OrganizationsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const organizations = await prisma.organization.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { users: true } } },
  });

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Organizations</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage organizations. Users are assigned to one organization.
        </p>
      </div>
      <OrganizationManager initialOrganizations={organizations} />
    </div>
  );
}
