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

const CreateSchemaBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  projectIds: z.array(z.string()).optional(),
  columns: z.array(ColumnSchema).min(1),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = CreateSchemaBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, description, projectIds, columns } = parsed.data;

  const schema = await prisma.schema.create({
    data: {
      name,
      description,
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
}
