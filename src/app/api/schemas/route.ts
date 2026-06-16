import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, withHandler } from "@/lib/api-error";
import { checkColumnClassifications } from "@/lib/classification-compat";
import { VisualizationSchema, validateVisualizations, type VisualizationInput } from "@/lib/visualization-input";

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
  visualizations: z.array(VisualizationSchema).optional(),
});

/** Build the nested `create` payload for visualizations, normalizing per type. */
function visualizationCreateData(visualizations: VisualizationInput[]) {
  return visualizations.map((v, i) => ({
    type: v.type,
    title: v.title,
    aggregate: v.aggregate,
    valueColumn: v.valueColumn,
    xColumn: v.type === "INDICATOR" ? null : v.xColumn ?? null,
    granularity: v.type === "INDICATOR" ? null : v.granularity ?? null,
    order: i,
  }));
}

export const GET = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const schemas = await prisma.schema.findMany({
    where: { deletedAt: null },
    include: {
      columns: { orderBy: { order: "asc" } },
      visualizations: { orderBy: { order: "asc" } },
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

  const { name, description, projectIds, columns, visualizations } = parsed.data;

  const compatError = await checkColumnClassifications(columns);
  if (compatError) return apiBadRequest(compatError);

  if (visualizations?.length) {
    const vizError = validateVisualizations(columns, visualizations);
    if (vizError) return apiBadRequest(vizError);
  }

  const schema = await prisma.schema.create({
    data: {
      name,
      description,
      columns: {
        create: columns.map((col, i) => ({ ...col, order: i })),
      },
      ...(visualizations?.length && {
        visualizations: { create: visualizationCreateData(visualizations) },
      }),
      ...(projectIds?.length && {
        projects: { create: projectIds.map((projectId) => ({ projectId })) },
      }),
    },
    include: {
      columns: { orderBy: { order: "asc" } },
      visualizations: { orderBy: { order: "asc" } },
      projects: { include: { project: { select: { id: true, name: true } } } },
    },
  });

  return NextResponse.json(schema, { status: 201 });
});
