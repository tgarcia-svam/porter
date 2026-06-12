import { NextRequest, NextResponse } from "next/server";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, apiConflict, withHandler } from "@/lib/api-error";
import { ClassificationBody, toClassificationData } from "@/lib/classification-input";
import { Prisma } from "@prisma/client";

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
  const parsed = ClassificationBody.safeParse(body);
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  try {
    const classification = await prisma.classification.create({
      data: toClassificationData(parsed.data),
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
