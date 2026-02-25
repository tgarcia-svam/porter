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
  columns: z.array(ColumnSchema).min(1).optional(),
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
    include: { columns: { orderBy: { order: "asc" } } },
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

  const { name, description, columns } = parsed.data;

  // Replace columns atomically
  const schema = await prisma.$transaction(async (tx) => {
    if (columns) {
      await tx.schemaColumn.deleteMany({ where: { schemaId: id } });
      await tx.schemaColumn.createMany({
        data: columns.map((col, i) => ({ ...col, schemaId: id, order: i })),
      });
    }
    return tx.schema.update({
      where: { id },
      data: { ...(name && { name }), ...(description !== undefined && { description }) },
      include: { columns: { orderBy: { order: "asc" } } },
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
