import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { auditStore, clientIp } from "@/lib/audit-context";

const UpdateUserBody = z.object({
  role: z.enum(["ADMIN", "UPLOADER"]).optional(),
  name: z.string().optional(),
  organizationId: z.string().nullable().optional(),
});

async function requireAdmin(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return null;
  auditStore.enterWith({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    ip: clientIp(req),
  });
  return session;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const parsed = UpdateUserBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json(user);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  await prisma.user.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
