import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { upsertAllSchemaViews, dropAllSchemaViews } from "@/lib/schema-view";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, apiNotFound, withHandler } from "@/lib/api-error";

const ColumnSchema = z.object({
  name: z.string().min(1),
  dataType: z.enum(["TEXT", "NUMBER", "INTEGER", "BOOLEAN", "DATE", "EMAIL"]),
  required: z.boolean().default(true),
  order: z.number().int().default(0),
  classificationId: z.string().nullable().optional(),
});

const UpdateSchemaBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  projectIds: z.array(z.string()).optional(),
  columns: z.array(ColumnSchema).min(1).optional(),
  timeSeriesColumn: z.string().nullable().optional(),
  timeSeriesGranularity: z.enum(["DAY", "MONTH", "YEAR"]).nullable().optional(),
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
        projects: { include: { project: { select: { id: true, name: true } } } },
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

    const { name, description, projectIds, columns, timeSeriesColumn, timeSeriesGranularity } = parsed.data;

    // Capture old project list + name before mutating (needed to drop stale views)
    const oldSchema = await prisma.schema.findUnique({
      where: { id },
      select: { name: true, projects: { include: { project: { select: { id: true, name: true } } } } },
    });
    const oldProjects = oldSchema?.projects.map((sp) => sp.project) ?? [];
    const oldName = oldSchema?.name ?? "";

    // Replace columns and project assignments atomically
    const schema = await prisma.$transaction(async (tx) => {
      if (columns) {
        await tx.schemaColumn.deleteMany({ where: { schemaId: id } });
        await tx.schemaColumn.createMany({
          data: columns.map((col, i) => ({ ...col, schemaId: id, order: i })),
        });
      }
      if (projectIds !== undefined) {
        await tx.schemaProject.deleteMany({ where: { schemaId: id } });
        if (projectIds.length > 0) {
          await tx.schemaProject.createMany({
            data: projectIds.map((projectId) => ({ schemaId: id, projectId })),
          });
        }
      }
      return tx.schema.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(timeSeriesColumn !== undefined && { timeSeriesColumn }),
          ...(timeSeriesGranularity !== undefined && { timeSeriesGranularity }),
          // Bump version whenever columns change so FileUpload records can be
          // interpreted against the exact schema definition that was in effect.
          ...(columns && { version: { increment: 1 } }),
        },
        include: {
          columns: { orderBy: { order: "asc" } },
          projects: { include: { project: { select: { id: true, name: true } } } },
        },
      });
    });

    // Drop views that may have changed name (schema renamed) or lost a project
    await dropAllSchemaViews(prisma, oldProjects, oldName);
    const newProjects = schema.projects.map((sp) => sp.project);
    await upsertAllSchemaViews(prisma, newProjects, schema.id, schema.name, schema.columns);

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
      select: { deletedAt: true, name: true, projects: { include: { project: { select: { id: true, name: true } } } } },
    });
    if (!existing || existing.deletedAt) return apiNotFound();

    const projects = existing.projects.map((sp) => sp.project);
    await dropAllSchemaViews(prisma, projects, existing.name);
    await prisma.schema.update({ where: { id }, data: { deletedAt: new Date() } });
    return new NextResponse(null, { status: 204 });
  }
);
