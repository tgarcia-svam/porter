import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const projects = await prisma.project.findMany({
    include: {
      organizations: {
        include: { organization: { select: { id: true, name: true } } },
        orderBy: { assignedAt: "asc" },
      },
      schemas: {
        include: { schema: { select: { id: true, name: true } } },
        orderBy: { assignedAt: "asc" },
      },
      _count: { select: { schemas: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(projects);
}

const CreateBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: {
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
    },
    include: {
      organizations: {
        include: { organization: { select: { id: true, name: true } } },
      },
      schemas: {
        include: { schema: { select: { id: true, name: true } } },
      },
      _count: { select: { schemas: true } },
    },
  });

  return NextResponse.json(project, { status: 201 });
}
