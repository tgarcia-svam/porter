import { prisma } from "@/lib/prisma";
import UserManager from "@/components/admin/UserManager";

export default async function UsersPage() {
  const [users, schemas] = await Promise.all([
    prisma.user.findMany({
      include: {
        assignments: {
          include: { schema: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.schema.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="mt-1 text-sm text-gray-500">
          Add users by email and assign schemas to them.
        </p>
      </div>

      <UserManager
        initialUsers={users.map((u) => ({
          ...u,
          createdAt: u.createdAt.toISOString(),
          role: u.role as "ADMIN" | "UPLOADER",
        }))}
        allSchemas={schemas}
      />
    </div>
  );
}
