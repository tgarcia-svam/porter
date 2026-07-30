import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, apiNotFound, withHandler } from "@/lib/api-error";
import { checkColumnClassifications } from "@/lib/classification-compat";
import { VisualizationSchema, validateVisualizations } from "@/lib/visualization-input";

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

const UpdateSchemaBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  projectIds: z.array(z.string()).optional(),
  columns: z.array(ColumnSchema).min(1).optional(),
  visualizations: z.array(VisualizationSchema).optional(),
  comparisons: z.array(ComparisonRuleSchema).optional(),
});

export const GET = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    const schema = await prisma.schema.findUnique({
      where: { id },
      include: {
        columns: { orderBy: { order: "asc" } },
        visualizations: { orderBy: { order: "asc" } },
        projects: { include: { project: { select: { id: true, name: true } } } },
        comparisons: true,
      },
    });

    if (!schema || schema.deletedAt) return apiNotFound();
    return NextResponse.json(schema);
  }
);

export const PUT = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;

    const softDeleted = await prisma.schema.findUnique({ where: { id }, select: { deletedAt: true } });
    if (!softDeleted || softDeleted.deletedAt) return apiNotFound();

    const body = await req.json();
    const parsed = UpdateSchemaBody.safeParse(body);
    if (!parsed.success) return apiBadRequest(parsed.error.flatten());

    const { name, description, projectIds, columns, visualizations, comparisons } = parsed.data;

    if (columns) {
      const compatError = await checkColumnClassifications(columns);
      if (compatError) return apiBadRequest(compatError);
    }

    // Validate visualizations + comparisons against the columns that will be in
    // effect: the incoming columns when provided, otherwise the existing ones.
    let effectiveColumns: ColumnRef[] | undefined;
    const needsEffectiveColumns = (visualizations?.length ?? 0) > 0 || (comparisons !== undefined);
    if (needsEffectiveColumns) {
      if (columns) {
        effectiveColumns = columns;
      } else {
        effectiveColumns = await prisma.schemaColumn.findMany({
          where: { schemaId: id },
          select: { name: true, dataType: true },
        });
      }
    }

    if (visualizations?.length && effectiveColumns) {
      const vizError = validateVisualizations(effectiveColumns, visualizations);
      if (vizError) return apiBadRequest(vizError);
    }

    if (comparisons !== undefined && effectiveColumns) {
      const compError = validateComparisonRules(effectiveColumns, comparisons);
      if (compError) return apiBadRequest(compError);
    }

    // Replace columns, visualizations, and project assignments atomically
    const schema = await prisma.$transaction(async (tx) => {
      if (columns) {
        await tx.schemaColumn.deleteMany({ where: { schemaId: id } });
        await tx.schemaColumn.createMany({
          data: columns.map((col, i) => ({ ...col, schemaId: id, order: i })),
        });
      }
      if (visualizations !== undefined) {
        await tx.visualization.deleteMany({ where: { schemaId: id } });
        if (visualizations.length > 0) {
          await tx.visualization.createMany({
            data: visualizations.map((v, i) => ({
              schemaId: id,
              type: v.type,
              title: v.title,
              aggregate: v.aggregate,
              valueColumn: v.valueColumn,
              xColumn: v.type === "INDICATOR" ? null : v.xColumn ?? null,
              granularity: v.type === "INDICATOR" ? null : v.granularity ?? null,
              order: i,
            })),
          });
        }
      }
      if (projectIds !== undefined) {
        await tx.schemaProject.deleteMany({ where: { schemaId: id } });
        if (projectIds.length > 0) {
          await tx.schemaProject.createMany({
            data: projectIds.map((projectId) => ({ schemaId: id, projectId })),
          });
        }
      }
      if (comparisons !== undefined) {
        await tx.schemaColumnComparison.deleteMany({ where: { schemaId: id } });
        if (comparisons.length > 0) {
          await tx.schemaColumnComparison.createMany({
            data: comparisons.map((r) => ({
              schemaId: id,
              sourceColumnName: r.sourceColumnName,
              operator: r.operator,
              targetColumnName: r.targetColumnName,
            })),
          });
        }
      }
      return tx.schema.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          // Bump version whenever columns or comparison rules change — both affect
          // validation semantics for FileUpload records.
          ...((columns || comparisons !== undefined) && { version: { increment: 1 } }),
        },
        include: {
          columns: { orderBy: { order: "asc" } },
          visualizations: { orderBy: { order: "asc" } },
          projects: { include: { project: { select: { id: true, name: true } } } },
          comparisons: true,
        },
      });
    });

    return NextResponse.json(schema);
  }
);

export const DELETE = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    const existing = await prisma.schema.findUnique({
      where: { id },
      select: { deletedAt: true },
    });
    if (!existing || existing.deletedAt) return apiNotFound();

    await prisma.schema.update({ where: { id }, data: { deletedAt: new Date() } });
    return new NextResponse(null, { status: 204 });
  }
);
