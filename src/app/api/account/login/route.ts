import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { apiBadRequest, withHandler } from "@/lib/api-error";
import {
  verifyPassword,
  getLockState,
  recordFailedAttempt,
  recordSuccess,
} from "@/lib/password-auth";
import { verifyTotp } from "@/lib/totp";
import { decryptSecret } from "@/lib/crypto-at-rest";
import { issueLoginTicket } from "@/lib/login-ticket";

/**
 * Local sign-in pre-check. Verifies password + TOTP and enforces lockout, then
 * issues a short-lived login ticket the client exchanges via NextAuth's
 * credentials provider. All distinct outcomes are expressed as { code } so the
 * login UI can message precisely; a non-existent / SSO / password-less account
 * returns the same generic bad_credentials to avoid user enumeration.
 *
 * Codes: bad_credentials | mfa_required | mfa_invalid | locked_temp |
 *        locked_reset | mfa_setup_required
 */

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().optional(),
});

const generic = () =>
  NextResponse.json({ ok: false, code: "bad_credentials" }, { status: 401 });

const lockResponse = (state: { reason: string; retryAfterSec?: number }) =>
  NextResponse.json(
    { ok: false, code: state.reason, retryAfterSec: state.retryAfterSec },
    { status: 423 }
  );

export const POST = withHandler(async (req: NextRequest) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const email = parsed.data.email.toLowerCase();
  const { password, totp } = parsed.data;

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });

  // No enumeration: unknown / SSO / not-yet-set-up accounts all look the same.
  if (!user || user.authMethod !== "PASSWORD" || !user.passwordHash) return generic();

  // Locked before we even check the password.
  const lock = getLockState(user);
  if (lock.locked) return lockResponse(lock);

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    const state = await recordFailedAttempt(user);
    if (state.locked) return lockResponse(state);
    return generic();
  }

  // A usable password account always has MFA enrolled (set-password flow enforces
  // it). If somehow not, force re-enrollment via the reset link.
  if (!user.mfaEnabled || !user.mfaSecretEnc) {
    return NextResponse.json({ ok: false, code: "mfa_setup_required" }, { status: 403 });
  }

  // Password correct — ask for the 6-digit code if not supplied yet.
  if (!totp) {
    return NextResponse.json({ ok: false, code: "mfa_required" }, { status: 200 });
  }

  const secret = decryptSecret(user.mfaSecretEnc);
  if (!(await verifyTotp(totp, secret))) {
    // Wrong TOTP counts toward lockout to bound MFA brute-forcing.
    const state = await recordFailedAttempt(user);
    if (state.locked) return lockResponse(state);
    return NextResponse.json({ ok: false, code: "mfa_invalid" }, { status: 401 });
  }

  await recordSuccess(user);
  return NextResponse.json({ ok: true, ticket: issueLoginTicket(email) });
});
