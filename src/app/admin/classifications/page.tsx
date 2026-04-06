import { prisma } from "@/lib/prisma";
import ClassificationManager from "@/components/admin/ClassificationManager";

export const dynamic = 'force-dynamic';

export default async function ClassificationsPage() {
  const classifications = await prisma.classification.findMany({
    include: { _count: { select: { columns: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Classifications</h1>
        <p className="mt-1 text-sm text-gray-500">
          Define lists of expected values that can be assigned to columns in a file format.
        </p>
      </div>

      <ClassificationManager initialClassifications={classifications} />
    </div>
  );
}
