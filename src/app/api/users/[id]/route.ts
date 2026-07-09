import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, apiNotFound, withHandler } from "@/lib/api-error";
import { createAuthToken, invalidateUserTokens } from "@/lib/auth-tokens";
import { sendInviteEmail, sendResetEmail } from "@/lib/email";

const UpdateUserBody = z.object({
  role: z.enum(["ADMIN", "UPLOADER"]).optional(),
  name: z.string().optional(),
  organizationId: z.string().nullable().optional(),
  authMethod: z.enum(["PASSWORD", "SSO"]).optional(),
  unlock: z.boolean().optional(),       // clear lockout (incl. hard lockedForReset)
  resetMfa: z.boolean().optional(),     // clear MFA + email a reset/re-enroll link
  resendInvite: z.boolean().optional(), // re-send the set-password invite link
});

export const PUT = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;
    const parsed = UpdateUserBody.safeParse(await req.json());
    if (!parsed.success) return apiBadRequest(parsed.error.flatten());

    const current = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, authMethod: true },
    });
    if (!current) return apiNotFound();

    const { unlock, resetMfa, resendInvite, authMethod, ...rest } = parsed.data;

    const data: Prisma.UserUncheckedUpdateInput = { ...rest };

    if (unlock) {
      data.failedLoginAttempts = 0;
      data.lastFailedLoginAt = null;
      data.lockedUntil = null;
      data.lockedForReset = false;
    }

    if (authMethod) {
      data.authMethod = authMethod;
      // Switching to SSO strips local credentials; switching to PASSWORD leaves the
      // account password-less until the invite below is completed.
      if (authMethod === "SSO") {
        data.passwordHash = null;
        data.mfaEnabled = false;
        data.mfaSecretEnc = null;
      }
    }

    if (resetMfa) {
      data.mfaEnabled = false;
      data.mfaSecretEnc = null;
    }

    const user = await prisma.user.update({ where: { id }, data });

    // Clearing MFA or moving to SSO also removes any registered passkeys.
    if (resetMfa || authMethod === "SSO") {
      await prisma.passkey.deleteMany({ where: { userId: id } });
    }

    // ── Side-effects (token issuance + email) ────────────────────────────────
    const switchedToPassword = authMethod === "PASSWORD" && current.authMethod !== "PASSWORD";

    if ((resendInvite || switchedToPassword) && user.authMethod === "PASSWORD") {
      await invalidateUserTokens(user.id, "INVITE");
      const { rawToken } = await createAuthToken({ userId: user.id, purpose: "INVITE" });
      try {
        await sendInviteEmail(user.email, rawToken);
      } catch (err) {
        console.error("[users] failed to send invite email:", err);
      }
    } else if (resetMfa && user.authMethod === "PASSWORD") {
      // No in-login enrollment path, so recovery is via a reset link: the user
      // sets a password and re-enrolls MFA in one flow.
      await invalidateUserTokens(user.id, "RESET");
      const { rawToken } = await createAuthToken({ userId: user.id, purpose: "RESET" });
      try {
        await sendResetEmail(user.email, rawToken);
      } catch (err) {
        console.error("[users] failed to send MFA-reset email:", err);
      }
    }

    // Minimal, client-safe response — never echo passwordHash / mfaSecretEnc.
    return NextResponse.json({ ok: true, id: user.id });
  }
);

export const DELETE = withHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const session = await requireAdmin(req);
    if (!session) return apiForbidden();

    const { id } = await params;

    if (id === session.user.id) return apiForbidden("Cannot delete your own account");

    const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!target) return apiNotFound();

    if (target.role === "ADMIN") {
      const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) return apiForbidden("Cannot remove the last admin account");
    }

    await prisma.user.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  }
);
