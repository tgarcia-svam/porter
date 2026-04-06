import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const assignments = await prisma.projectOrganization.findMany({
    where: { projectId: id },
    include: { organization: true },
  });

  return NextResponse.json(assignments.map((a) => a.organization));
}

const AssignBody = z.object({ organizationId: z.string() });

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

  const assignment = await prisma.projectOrganization.upsert({
    where: {
      projectId_organizationId: {
        projectId: id,
        organizationId: parsed.data.organizationId,
      },
    },
    create: { projectId: id, organizationId: parsed.data.organizationId },
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
  const organizationId = searchParams.get("organizationId");
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId required" }, { status: 400 });
  }

  await prisma.projectOrganization.delete({
    where: {
      projectId_organizationId: { projectId: id, organizationId },
    },
  });

  return new NextResponse(null, { status: 204 });
}
