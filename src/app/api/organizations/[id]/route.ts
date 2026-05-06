import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, apiNotFound, withHandler } from "@/lib/api-error";

const UpdateBody = z.object({
  name: z.string().min(1),
});

export const PUT = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;

    const existing = await prisma.organization.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return apiNotFound();

    const body = await req.json();
    const parsed = UpdateBody.safeParse(body);
    if (!parsed.success) return apiBadRequest(parsed.error.flatten());

    const organization = await prisma.organization.update({
      where: { id },
      data: { name: parsed.data.name.trim() },
      include: { _count: { select: { users: true } } },
    });

    return NextResponse.json(organization);
  }
);

export const DELETE = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    const existing = await prisma.organization.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return apiNotFound();

    await prisma.organization.update({ where: { id }, data: { deletedAt: new Date() } });
    return new NextResponse(null, { status: 204 });
  }
);
