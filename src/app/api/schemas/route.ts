import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { upsertAllSchemaViews } from "@/lib/schema-view";
import { requireAdmin } from "@/lib/api-auth";

const ColumnSchema = z.object({
  name: z.string().min(1),
  dataType: z.enum(["TEXT", "NUMBER", "INTEGER", "BOOLEAN", "DATE", "EMAIL"]),
  required: z.boolean().default(true),
  order: z.number().int().default(0),
});

const CreateSchemaBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  projectIds: z.array(z.string()).optional(),
  columns: z.array(ColumnSchema).min(1),
  timeSeriesColumn: z.string().nullable().optional(),
  timeSeriesGranularity: z.enum(["DAY", "MONTH", "YEAR"]).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const schemas = await prisma.schema.findMany({
    include: {
      columns: { orderBy: { order: "asc" } },
      projects: { include: { project: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(schemas);
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = CreateSchemaBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, description, projectIds, columns, timeSeriesColumn, timeSeriesGranularity } = parsed.data;

  const schema = await prisma.schema.create({
    data: {
      name,
      description,
      timeSeriesColumn: timeSeriesColumn ?? null,
      timeSeriesGranularity: timeSeriesGranularity ?? null,
      columns: {
        create: columns.map((col, i) => ({ ...col, order: i })),
      },
      ...(projectIds?.length && {
        projects: { create: projectIds.map((projectId) => ({ projectId })) },
      }),
    },
    include: {
      columns: { orderBy: { order: "asc" } },
      projects: { include: { project: { select: { id: true, name: true } } } },
    },
  });

  const projects = schema.projects.map((sp) => sp.project);
  await upsertAllSchemaViews(prisma, projects, schema.id, schema.name, schema.columns);

  return NextResponse.json(schema, { status: 201 });
}
