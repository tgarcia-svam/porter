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

const ComparisonRuleSchema = z.object({
  sourceColumnName: z.string().min(1),
  operator: z.enum(["LT", "LTE", "GT", "GTE"]),
  targetColumnName: z.string().min(1),
});

const CreateSchemaBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  projectIds: z.array(z.string()).optional(),
  columns: z.array(ColumnSchema).min(1),
  visualizations: z.array(VisualizationSchema).optional(),
  comparisons: z.array(ComparisonRuleSchema).optional(),
});

type ColumnRef = { name: string; dataType: string };

function comparisonTypeGroup(dt: string): "numeric" | "date" | null {
  if (dt === "NUMBER" || dt === "INTEGER") return "numeric";
  if (dt === "DATE") return "date";
  return null;
}

function validateComparisonRules(
  columns: ColumnRef[],
  rules: z.infer<typeof ComparisonRuleSchema>[]
): string | null {
  const typeByName = new Map(columns.map((c) => [c.name, c.dataType]));
  const seen = new Set<string>();
  for (const rule of rules) {
    if (rule.sourceColumnName === rule.targetColumnName) {
      return `Comparison rule: source and target cannot be the same column ("${rule.sourceColumnName}").`;
    }
    const srcType = typeByName.get(rule.sourceColumnName);
    const tgtType = typeByName.get(rule.targetColumnName);
    if (srcType === undefined) return `Comparison rule references unknown column "${rule.sourceColumnName}".`;
    if (tgtType === undefined) return `Comparison rule references unknown column "${rule.targetColumnName}".`;
    const srcGroup = comparisonTypeGroup(srcType);
    const tgtGroup = comparisonTypeGroup(tgtType);
    if (!srcGroup) return `Column "${rule.sourceColumnName}" (${srcType}) cannot be used in comparisons.`;
    if (!tgtGroup) return `Column "${rule.targetColumnName}" (${tgtType}) cannot be used in comparisons.`;
    if (srcGroup !== tgtGroup) {
      return `Columns "${rule.sourceColumnName}" and "${rule.targetColumnName}" are different type groups and cannot be compared.`;
    }
    const key = `${rule.sourceColumnName}|${rule.operator}|${rule.targetColumnName}`;
    if (seen.has(key)) return `Duplicate comparison rule: "${rule.sourceColumnName}" ${rule.operator} "${rule.targetColumnName}".`;
    seen.add(key);
  }
  return null;
}

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

  const { name, description, projectIds, columns, visualizations, comparisons } = parsed.data;

  const compatError = await checkColumnClassifications(columns);
  if (compatError) return apiBadRequest(compatError);

  if (visualizations?.length) {
    const vizError = validateVisualizations(columns, visualizations);
    if (vizError) return apiBadRequest(vizError);
  }

  if (comparisons?.length) {
    const compError = validateComparisonRules(columns, comparisons);
    if (compError) return apiBadRequest(compError);
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
      ...(comparisons?.length && {
        comparisons: {
          create: comparisons.map((r) => ({
            sourceColumnName: r.sourceColumnName,
            operator: r.operator,
            targetColumnName: r.targetColumnName,
          })),
        },
      }),
    },
    include: {
      columns: { orderBy: { order: "asc" } },
      visualizations: { orderBy: { order: "asc" } },
      projects: { include: { project: { select: { id: true, name: true } } } },
      comparisons: true,
    },
  });

  return NextResponse.json(schema, { status: 201 });
});
