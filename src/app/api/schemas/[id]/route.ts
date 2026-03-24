import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const ColumnSchema = z.object({
  name: z.string().min(1),
  dataType: z.enum(["TEXT", "NUMBER", "INTEGER", "BOOLEAN", "DATE", "EMAIL"]),
  required: z.boolean().default(true),
  order: z.number().int().default(0),
});

const UpdateSchemaBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  projectIds: z.array(z.string()).optional(),
  columns: z.array(ColumnSchema).min(1).optional(),
  timeSeriesColumn: z.string().nullable().optional(),
  timeSeriesGranularity: z.enum(["DAY", "MONTH", "YEAR"]).nullable().optional(),
});

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const schema = await prisma.schema.findUnique({
    where: { id },
    include: {
      columns: { orderBy: { order: "asc" } },
      projects: { include: { project: { select: { id: true, name: true } } } },
    },
  });

  if (!schema) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(schema);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const parsed = UpdateSchemaBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, description, projectIds, columns, timeSeriesColumn, timeSeriesGranularity } = parsed.data;

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
      },
      include: {
        columns: { orderBy: { order: "asc" } },
        projects: { include: { project: { select: { id: true, name: true } } } },
      },
    });
  });

  return NextResponse.json(schema);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  await prisma.schema.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
