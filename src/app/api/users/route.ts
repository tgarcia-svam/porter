import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { auditStore, clientIp } from "@/lib/audit-context";

const CreateUserBody = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(["ADMIN", "UPLOADER"]).default("UPLOADER"),
  organizationId: z.string().optional().nullable(),
});

async function requireAdmin(req?: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return null;
  auditStore.enterWith({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    ip: req ? clientIp(req) : undefined,
  });
  return session;
}

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const users = await prisma.user.findMany({
    include: {
      organization: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = CreateUserBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "User already exists" }, { status: 409 });
  }

  const user = await prisma.user.create({ data: { ...parsed.data, email } });
  return NextResponse.json(user, { status: 201 });
}
