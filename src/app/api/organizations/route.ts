import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, withHandler } from "@/lib/api-error";

export const GET = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const organizations = await prisma.organization.findMany({
    where: { deletedAt: null },
    include: { _count: { select: { users: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(organizations);
});

const CreateBody = z.object({
  name: z.string().min(1),
});

export const POST = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const body = await req.json();
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const organization = await prisma.organization.create({
    data: { name: parsed.data.name.trim() },
    include: { _count: { select: { users: true } } },
  });

  return NextResponse.json(organization, { status: 201 });
});
