import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, withHandler } from "@/lib/api-error";

const ColumnSchema = z.object({
  name: z.string().min(1),
  dataType: z.enum(["TEXT", "NUMBER", "INTEGER", "BOOLEAN", "DATE", "EMAIL"]),
  required: z.boolean().default(true),
  order: z.number().int().default(0),
  classificationId: z.string().nullable().optional(),
});

const CreateSchemaBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  projectIds: z.array(z.string()).optional(),
  columns: z.array(ColumnSchema).min(1),
  timeSeriesColumn: z.string().nullable().optional(),
  timeSeriesGranularity: z.enum(["DAY", "MONTH", "YEAR"]).nullable().optional(),
});

export const GET = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const schemas = await prisma.schema.findMany({
    where: { deletedAt: null },
    include: {
      columns: { orderBy: { order: "asc" } },
      projects: {
        where: { project: { deletedAt: null } },
        include: { project: { select: { id: true, name: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(schemas);
});

export const POST = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const body = await req.json();
  const parsed = CreateSchemaBody.safeParse(body);
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

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

  return NextResponse.json(schema, { status: 201 });
});
