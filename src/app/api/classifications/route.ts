import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";

const CreateBody = z.object({
  name: z.string().min(1),
  values: z.array(z.string().min(1)).min(1),
  caseSensitive: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const classifications = await prisma.classification.findMany({
    include: { _count: { select: { columns: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(classifications);
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, values, caseSensitive } = parsed.data;

  try {
    const classification = await prisma.classification.create({
      data: { name, values, caseSensitive },
      include: { _count: { select: { columns: true } } },
    });
    return NextResponse.json(classification, { status: 201 });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A classification with that name already exists" }, { status: 409 });
    }
    throw e;
  }
}
