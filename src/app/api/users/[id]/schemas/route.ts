import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const assignments = await prisma.userSchemaAssignment.findMany({
    where: { userId: id },
    include: { schema: true },
  });

  return NextResponse.json(assignments.map((a) => a.schema));
}

const AssignBody = z.object({
  schemaId: z.string(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const parsed = AssignBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const assignment = await prisma.userSchemaAssignment.upsert({
    where: { userId_schemaId: { userId: id, schemaId: parsed.data.schemaId } },
    create: { userId: id, schemaId: parsed.data.schemaId },
    update: {},
  });

  return NextResponse.json(assignment, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const schemaId = searchParams.get("schemaId");
  if (!schemaId) {
    return NextResponse.json({ error: "schemaId required" }, { status: 400 });
  }

  await prisma.userSchemaAssignment.delete({
    where: { userId_schemaId: { userId: id, schemaId } },
  });

  return new NextResponse(null, { status: 204 });
}
