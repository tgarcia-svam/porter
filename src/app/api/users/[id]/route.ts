import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, withHandler } from "@/lib/api-error";

const UpdateUserBody = z.object({
  role: z.enum(["ADMIN", "UPLOADER"]).optional(),
  name: z.string().optional(),
  organizationId: z.string().nullable().optional(),
  unlock: z.boolean().optional(),
});

export const PUT = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    const body = await req.json();
    const parsed = UpdateUserBody.safeParse(body);
    if (!parsed.success) return apiBadRequest(parsed.error.flatten());

    const { unlock, ...rest } = parsed.data;
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...rest,
        ...(unlock ? { failedLoginAttempts: 0, lockedUntil: null } : {}),
      },
    });

    return NextResponse.json(user);
  }
);

export const DELETE = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    await prisma.user.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  }
);
