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
import { issuePendingTicket, verifyPendingTicket, issueLoginTicket } from "@/lib/login-ticket";
import {
  verifyAuthentication,
  readChallenge,
  CHALLENGE_COOKIE,
  type AuthenticationResponse,
} from "@/lib/webauthn";

/**
 * Local sign-in. Two-step, single endpoint:
 *
 *   1. { email, password }              → verify password + lockout. On success,
 *                                          if a second factor is required, returns
 *                                          { code:"mfa_required", pendingTicket,
 *                                          methods:{ passkey, totp } }.
 *   2a. { email, pendingTicket, totp }     → verify TOTP, then issue login ticket.
 *   2b. { email, pendingTicket, passkey }  → verify WebAuthn assertion (challenge
 *                                            from the pk-challenge cookie), then
 *                                            issue login ticket.
 *
 * The login ticket is exchanged by NextAuth's credentials provider. Distinct
 * { code }s let the UI message precisely; unknown/SSO/password-less accounts all
 * return generic bad_credentials (no enumeration).
 *
 * Codes: bad_credentials | mfa_required | mfa_invalid | locked_temp |
 *        locked_reset | mfa_setup_required | expired
 */

const Body = z.object({
  email: z.string().email(),
  password: z.string().optional(),
  pendingTicket: z.string().optional(),
  totp: z.string().optional(),
  passkey: z.unknown().optional(), // WebAuthn AuthenticationResponseJSON
});

const generic = () =>
  NextResponse.json({ ok: false, code: "bad_credentials" }, { status: 401 });

const expired = () =>
  NextResponse.json({ ok: false, code: "expired" }, { status: 401 });

const lockResponse = (state: { reason: string; retryAfterSec?: number }) =>
  NextResponse.json(
    { ok: false, code: state.reason, retryAfterSec: state.retryAfterSec },
    { status: 423 }
  );

const success = (email: string) => {
  const res = NextResponse.json({ ok: true, ticket: issueLoginTicket(email) });
  // Challenge is single-use — drop it once consumed.
  res.cookies.set(CHALLENGE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
};

export const POST = withHandler(async (req: NextRequest) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const email = parsed.data.email.toLowerCase();
  const { password, pendingTicket, totp } = parsed.data;

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (!user || user.authMethod !== "PASSWORD" || !user.passwordHash) return generic();

  // Always block a locked account before any credential/second-factor work.
  const lock = getLockState(user);
  if (lock.locked) return lockResponse(lock);

  const passkeys = await prisma.passkey.findMany({ where: { userId: user.id } });
  const hasPasskey = passkeys.length > 0;
  const hasTotp = user.mfaEnabled && !!user.mfaSecretEnc;

  // ── Step 1: password ──────────────────────────────────────────────────────
  if (password) {
    if (!(await verifyPassword(password, user.passwordHash))) {
      const state = await recordFailedAttempt(user);
      if (state.locked) return lockResponse(state);
      return generic();
    }
    if (!hasTotp && !hasPasskey) {
      return NextResponse.json({ ok: false, code: "mfa_setup_required" }, { status: 403 });
    }
    return NextResponse.json({
      ok: false,
      code: "mfa_required",
      pendingTicket: issuePendingTicket(email),
      methods: { passkey: hasPasskey, totp: hasTotp },
    });
  }

  // ── Step 2: second factor (needs a valid pending ticket) ────────────────────
  if (!pendingTicket || verifyPendingTicket(pendingTicket) !== email) return expired();

  // 2a. TOTP
  if (totp) {
    if (!hasTotp || !user.mfaSecretEnc) return generic();
    if (!(await verifyTotp(totp, decryptSecret(user.mfaSecretEnc)))) {
      const state = await recordFailedAttempt(user);
      if (state.locked) return lockResponse(state);
      return NextResponse.json({ ok: false, code: "mfa_invalid" }, { status: 401 });
    }
    await recordSuccess(user);
    return success(email);
  }

  // 2b. Passkey assertion
  if (parsed.data.passkey) {
    const assertion = parsed.data.passkey as AuthenticationResponse;
    const cred = passkeys.find((p) => p.credentialId === assertion.id);
    const challenge = readChallenge(req.cookies.get(CHALLENGE_COOKIE)?.value, "auth", email);
    if (!cred || !challenge) {
      const state = await recordFailedAttempt(user);
      if (state.locked) return lockResponse(state);
      return NextResponse.json({ ok: false, code: "mfa_invalid" }, { status: 401 });
    }

    const { verified, newCounter } = await verifyAuthentication(assertion, challenge, {
      credentialId: cred.credentialId,
      publicKey: cred.publicKey,
      counter: cred.counter,
      transports: cred.transports,
    });
    if (!verified) {
      const state = await recordFailedAttempt(user);
      if (state.locked) return lockResponse(state);
      return NextResponse.json({ ok: false, code: "mfa_invalid" }, { status: 401 });
    }

    await prisma.passkey.update({
      where: { id: cred.id },
      data: { counter: newCounter, lastUsedAt: new Date() },
    });
    await recordSuccess(user);
    return success(email);
  }

  return generic();
});
