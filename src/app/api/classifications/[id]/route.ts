import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  values: z.array(z.string().min(1)).min(1).optional(),
  caseSensitive: z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const classification = await prisma.classification.findUnique({
    where: { id },
    include: { _count: { select: { columns: true } } },
  });

  if (!classification) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(classification);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const parsed = UpdateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const classification = await prisma.classification.update({
      where: { id },
      data: parsed.data,
      include: { _count: { select: { columns: true } } },
    });
    return NextResponse.json(classification);
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "P2002") {
      return NextResponse.json({ error: "A classification with that name already exists" }, { status: 409 });
    }
    if (code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  await prisma.classification.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
