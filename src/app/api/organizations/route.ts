import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const organizations = await prisma.organization.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(organizations);
}

const CreateBody = z.object({
  name: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const organization = await prisma.organization.create({
    data: { name: parsed.data.name.trim() },
    include: { _count: { select: { users: true } } },
  });

  return NextResponse.json(organization, { status: 201 });
}
