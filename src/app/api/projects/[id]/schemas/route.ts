import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";

const AssignBody = z.object({ schemaId: z.string() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const parsed = AssignBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const assignment = await prisma.schemaProject.upsert({
    where: {
      schemaId_projectId: { schemaId: parsed.data.schemaId, projectId: id },
    },
    create: { schemaId: parsed.data.schemaId, projectId: id },
    update: {},
  });

  return NextResponse.json(assignment, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const schemaId = searchParams.get("schemaId");
  if (!schemaId) {
    return NextResponse.json({ error: "schemaId required" }, { status: 400 });
  }

  await prisma.schemaProject.delete({
    where: { schemaId_projectId: { schemaId, projectId: id } },
  });

  return new NextResponse(null, { status: 204 });
}
