import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, withHandler } from "@/lib/api-error";

export const GET = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const projects = await prisma.project.findMany({
    where: { deletedAt: null },
    include: {
      organizations: {
        where: { organization: { deletedAt: null } },
        include: { organization: { select: { id: true, name: true } } },
        orderBy: { assignedAt: "asc" },
      },
      schemas: {
        where: { schema: { deletedAt: null } },
        include: { schema: { select: { id: true, name: true } } },
        orderBy: { assignedAt: "asc" },
      },
      _count: { select: { schemas: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(projects);
});

const CreateBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export const POST = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const body = await req.json();
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

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
});
