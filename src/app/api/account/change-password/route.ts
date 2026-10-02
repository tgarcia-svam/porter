import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { verifyPassword, hashPassword } from "@/lib/password-auth";
import { validatePassword } from "@/lib/password-policy";
import { withHandler, apiBadRequest } from "@/lib/api-error";
import { getPasswordPolicySettings } from "@/lib/password-policy-settings";
import { isPasswordInHistory, recordPasswordHistory } from "@/lib/password-history";

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
    select: { id: true, email: true, authMethod: true, passwordHash: true, passwordChangedAt: true, deletedAt: true },
  });

  if (!user || user.deletedAt || user.authMethod !== "PASSWORD" || !user.passwordHash) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentOk = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentOk) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const policy = await getPasswordPolicySettings();

  // Minimum password age — prevent rapid cycling to circumvent history checks.
  if (policy.minAgeHours > 0 && user.passwordChangedAt) {
    const ageMs    = Date.now() - user.passwordChangedAt.getTime();
    const minAgeMs = policy.minAgeHours * 3_600_000;
    if (ageMs < minAgeMs) {
      const remainingHours = Math.ceil((minAgeMs - ageMs) / 3_600_000);
      return NextResponse.json(
        { error: `You cannot change your password yet. Please wait ${remainingHours} more hour(s).` },
        { status: 400 }
      );
    }
  }

  const check = validatePassword(newPassword, user.email, policy);
  if (!check.ok) {
    return NextResponse.json({ error: check.errors }, { status: 422 });
  }

  // Password history: check against current hash + stored history.
  const inHistory = await isPasswordInHistory(user.id, newPassword, policy.historyCount, user.passwordHash);
  if (inHistory) {
    return NextResponse.json(
      { error: "This password has been used recently. Please choose a different one." },
      { status: 422 }
    );
  }

  const newHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data:  { passwordHash: newHash, passwordChangedAt: new Date() },
  });
  await recordPasswordHistory(user.id, newHash);

  return NextResponse.json({ ok: true });
});
