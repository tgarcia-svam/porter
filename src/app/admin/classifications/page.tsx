import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import ClassificationManager from "@/components/admin/ClassificationManager";

export const dynamic = 'force-dynamic';

export default async function ClassificationsPage() {
  const rows = await prisma.classification.findMany({
    include: { _count: { select: { columns: true } } },
    orderBy: { name: "asc" },
  });

  // Normalize date-only columns to ISO strings so the initial (RSC) shape
  // matches what /api/classifications returns on refresh (JSON strings).
  const classifications = rows.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    type: c.type,
    values: c.values,
    caseSensitive: c.caseSensitive,
    pattern: c.pattern,
    minNumber: c.minNumber,
    maxNumber: c.maxNumber,
    minDate: c.minDate ? c.minDate.toISOString() : null,
    maxDate: c.maxDate ? c.maxDate.toISOString() : null,
    _count: c._count,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Classifications</h1>
        <p className="mt-1 text-sm text-gray-500">
          Define reusable validation rules — value lists, regex patterns, number
          ranges, or date ranges — that can be assigned to columns in a file format.
        </p>
      </div>

      <ClassificationManager initialClassifications={classifications} />
    </div>
  );
}
