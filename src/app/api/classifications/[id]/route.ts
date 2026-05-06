import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, apiNotFound, apiConflict, withHandler } from "@/lib/api-error";
import { Prisma } from "@prisma/client";

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  values: z.array(z.string().min(1)).min(1).optional(),
  caseSensitive: z.boolean().optional(),
});

export const GET = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    const classification = await prisma.classification.findUnique({
      where: { id },
      include: { _count: { select: { columns: true } } },
    });

    if (!classification) return apiNotFound();
    return NextResponse.json(classification);
  }
);

export const PUT = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    const body = await req.json();
    const parsed = UpdateBody.safeParse(body);
    if (!parsed.success) return apiBadRequest(parsed.error.flatten());

    try {
      const classification = await prisma.classification.update({
        where: { id },
        data: parsed.data,
        include: { _count: { select: { columns: true } } },
      });
      return NextResponse.json(classification);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return apiConflict("A classification with that name already exists");
      }
      throw e; // P2025 (not found) → withHandler → 404; others → 500
    }
  }
);

export const DELETE = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    await prisma.classification.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  }
);
