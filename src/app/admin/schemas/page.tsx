import { prisma } from "@/lib/prisma";
import Link from "next/link";
import SchemaListClient from "@/components/admin/SchemaListClient";

export const dynamic = 'force-dynamic';

export default async function SchemasPage() {
  const schemas = await prisma.schema.findMany({
    include: {
      columns: { orderBy: { order: "asc" } },
      projects: { include: { project: { select: { id: true, name: true } } } },
      _count: { select: { uploads: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">File Formats</h1>
          <p className="mt-1 text-sm text-gray-500">
            Define file format requirements for uploaders.
          </p>
        </div>
        <Link
          href="/admin/schemas/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          New file format
        </Link>
      </div>

      <SchemaListClient initialSchemas={schemas} />
    </div>
  );
}
