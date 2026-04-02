/**
 * Idempotent script that ensures every (project × schema) view exists in the
 * `reports` PostgreSQL schema.  Run on every deploy after `prisma db push`.
 */
import { PrismaClient } from "@prisma/client";
import { upsertAllSchemaViews } from "../src/lib/schema-view";

const prisma = new PrismaClient();

async function main() {
  const schemas = await prisma.schema.findMany({
    include: {
      columns: { orderBy: { order: "asc" } },
      projects: { include: { project: { select: { id: true, name: true } } } },
    },
  });

  let viewCount = 0;

  for (const schema of schemas) {
    const projects = schema.projects.map((sp) => sp.project);
    if (projects.length === 0) continue;

    await upsertAllSchemaViews(
      prisma,
      projects,
      schema.id,
      schema.name,
      schema.columns
    );

    viewCount += projects.length;
    console.log(
      `  ✓ ${schema.name} → ${projects.map((p) => p.name).join(", ")}`
    );
  }

  console.log(`  ${viewCount} report view(s) synced.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
