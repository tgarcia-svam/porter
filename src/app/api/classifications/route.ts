import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, apiConflict, withHandler } from "@/lib/api-error";
import { Prisma } from "@prisma/client";

const CreateBody = z.object({
  name: z.string().min(1),
  values: z.array(z.string().min(1)).min(1),
  caseSensitive: z.boolean().default(true),
});

export const GET = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const classifications = await prisma.classification.findMany({
    include: { _count: { select: { columns: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(classifications);
});

export const POST = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const body = await req.json();
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const { name, values, caseSensitive } = parsed.data;

  try {
    const classification = await prisma.classification.create({
      data: { name, values, caseSensitive },
      include: { _count: { select: { columns: true } } },
    });
    return NextResponse.json(classification, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return apiConflict("A classification with that name already exists");
    }
    throw e;
  }
});
