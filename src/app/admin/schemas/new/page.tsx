import Link from "next/link";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import SchemaEditor from "@/components/admin/SchemaEditor";

export const dynamic = 'force-dynamic';

export default async function NewSchemaPage() {
  const [allProjects, allClassifications] = await Promise.all([
    prisma.project.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.classification.findMany({ select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/schemas"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <span aria-hidden>←</span> Back to File Formats
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">New File Format</h1>
        <p className="mt-1 text-sm text-gray-500">
          Define column names and required data types.
        </p>
      </div>
      <SchemaEditor allProjects={allProjects} allClassifications={allClassifications} />
    </div>
  );
}
