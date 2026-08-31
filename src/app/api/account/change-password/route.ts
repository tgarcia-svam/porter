import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { verifyPassword, hashPassword } from "@/lib/password-auth";
import { validatePassword } from "@/lib/password-policy";
import { withHandler, apiBadRequest } from "@/lib/api-error";

const Body = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(1),
});

export const POST = withHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { id: true, email: true, authMethod: true, passwordHash: true, deletedAt: true },
  });

  if (!user || user.deletedAt || user.authMethod !== "PASSWORD" || !user.passwordHash) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentOk = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentOk) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const check = validatePassword(newPassword, user.email);
  if (!check.ok) {
    return NextResponse.json({ error: check.errors }, { status: 422 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data:  { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
});
