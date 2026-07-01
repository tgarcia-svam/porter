import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import UserManager from "@/components/admin/UserManager";

export default async function UsersPage() {
  const [users, organizations] = await Promise.all([
    prisma.user.findMany({
      include: {
        organization: { select: { id: true, name: true } },
        _count: { select: { passkeys: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.organization.findMany({
      where: { deletedAt: null },
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
        // Pick fields explicitly — never ship passwordHash / mfaSecretEnc to the client.
        initialUsers={users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role as "ADMIN" | "UPLOADER",
          createdAt: u.createdAt.toISOString(),
          organization: u.organization,
          authMethod: u.authMethod as "PASSWORD" | "SSO",
          mfaEnabled: u.mfaEnabled,
          passkeyCount: u._count.passkeys,
          lockedUntil: u.lockedUntil ? u.lockedUntil.toISOString() : null,
          lockedForReset: u.lockedForReset,
          failedLoginAttempts: u.failedLoginAttempts,
        }))}
        allOrganizations={organizations}
      />
    </div>
  );
}
