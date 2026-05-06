import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, apiNotFound, withHandler } from "@/lib/api-error";

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

export const PUT = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return apiNotFound();

    const body = await req.json();
    const parsed = UpdateBody.safeParse(body);
    if (!parsed.success) return apiBadRequest(parsed.error.flatten());

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(parsed.data.name && { name: parsed.data.name.trim() }),
        ...(parsed.data.description !== undefined && {
          description: parsed.data.description.trim() || null,
        }),
      },
      include: {
        organizations: {
          include: { organization: { select: { id: true, name: true } } },
        },
        _count: { select: { schemas: true } },
      },
    });

    return NextResponse.json(project);
  }
);

export const DELETE = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return apiNotFound();

    await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
    return new NextResponse(null, { status: 204 });
  }
);
