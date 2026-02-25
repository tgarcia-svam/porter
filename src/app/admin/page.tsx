import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function AdminDashboard() {
  const [userCount, schemaCount, uploadCount, recentUploads] =
    await Promise.all([
      prisma.user.count(),
      prisma.schema.count(),
      prisma.fileUpload.count(),
      prisma.fileUpload.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { email: true, name: true } },
          schema: { select: { name: true } },
        },
      }),
    ]);

  const stats = [
    { label: "Users", value: userCount, href: "/admin/users" },
    { label: "Schemas", value: schemaCount, href: "/admin/schemas" },
    { label: "Total Uploads", value: uploadCount, href: null },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of Porter usage and activity.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl border border-gray-200 p-6"
          >
            <p className="text-sm text-gray-500">{stat.label}</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">{stat.value}</p>
            {stat.href && (
              <Link
                href={stat.href}
                className="mt-3 inline-block text-xs text-blue-600 hover:underline"
              >
                Manage →
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Recent uploads */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Uploads</h2>
        </div>
        {recentUploads.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">
            No uploads yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 font-medium text-gray-500">File</th>
                <th className="px-6 py-3 font-medium text-gray-500">User</th>
                <th className="px-6 py-3 font-medium text-gray-500">Schema</th>
                <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500">Date</th>
              </tr>
            </thead>
            <tbody>
              {recentUploads.map((upload) => (
                <tr key={upload.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-6 py-3 text-gray-900 font-medium max-w-[200px] truncate">
                    {upload.fileName}
                  </td>
                  <td className="px-6 py-3 text-gray-600">
                    {upload.user.name ?? upload.user.email}
                  </td>
                  <td className="px-6 py-3 text-gray-600">{upload.schema.name}</td>
                  <td className="px-6 py-3">
                    <StatusBadge status={upload.status} />
                  </td>
                  <td className="px-6 py-3 text-gray-400 text-xs">
                    {new Date(upload.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    VALID: "bg-green-100 text-green-700",
    INVALID: "bg-red-100 text-red-700",
    PENDING: "bg-gray-100 text-gray-600",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.PENDING}`}
    >
      {status}
    </span>
  );
}
