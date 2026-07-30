import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import SchemaPageTabs from "@/components/admin/SchemaPageTabs";

export const dynamic = 'force-dynamic';

export default async function SchemasPage() {
  const [schemas, classificationsRaw] = await Promise.all([
    prisma.schema.findMany({
      where: { deletedAt: null },
      include: {
        columns: {
          orderBy: { order: "asc" },
          include: { classification: { select: { name: true } } },
        },
        projects: {
          where: { project: { deletedAt: null } },
          include: { project: { select: { id: true, name: true } } },
        },
        _count: { select: { uploads: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.classification.findMany({
      include: { _count: { select: { columns: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const initialClassifications = classificationsRaw.map((c) => ({
    ...c,
    minDate: c.minDate ? c.minDate.toISOString() : null,
    maxDate: c.maxDate ? c.maxDate.toISOString() : null,
  }));

  return (
    <SchemaPageTabs
      initialSchemas={schemas}
      initialClassifications={initialClassifications}
    />
  );
}
