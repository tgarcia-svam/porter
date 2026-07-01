import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { apiBadRequest, withHandler } from "@/lib/api-error";
import { validatePassword } from "@/lib/password-policy";
import { hashPassword, clearLockoutForReset } from "@/lib/password-auth";
import {
  findValidToken,
  consumeAuthToken,
  createAuthToken,
  invalidateUserTokens,
} from "@/lib/auth-tokens";

/**
 * Set a password from an invite or reset link. Serves both INVITE (new user) and
 * RESET (existing user) tokens. On success it stores the bcrypt hash, clears all
 * lockout state (including the hard lockedForReset lock — a successful reset is the
 * only way to release it), and consumes the token.
 *
 * Response `next`:
 *   - "mfa"  + enrollToken → user has no MFA yet; client must complete enrollment
 *                            before the account can sign in.
 *   - "done"               → user already has MFA; ready to sign in.
 */

const Body = z.object({
  token: z.string().min(1),
  password: z.string().min(1),
});

export const POST = withHandler(async (req: NextRequest) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const { token, password } = parsed.data;

  // The set-password page is reached from either an invite or a reset link.
  const valid =
    (await findValidToken(token, "INVITE")) ?? (await findValidToken(token, "RESET"));
  if (!valid) {
    return NextResponse.json(
      { error: "This link is invalid or has expired. Request a new one." },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: valid.userId },
    select: { id: true, email: true, mfaEnabled: true },
  });
  if (!user) return apiBadRequest("Account no longer exists.");

  const check = validatePassword(password, user.email);
  if (!check.ok) return NextResponse.json({ error: check.errors }, { status: 422 });

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password) },
  });
  await clearLockoutForReset(user.id);
  await consumeAuthToken(valid.id);
  // Any other outstanding invite/reset links for this user are now stale.
  await invalidateUserTokens(user.id, "INVITE");
  await invalidateUserTokens(user.id, "RESET");

  if (!user.mfaEnabled) {
    const { rawToken } = await createAuthToken({ userId: user.id, purpose: "MFA_ENROLL" });
    return NextResponse.json({ ok: true, next: "mfa", enrollToken: rawToken });
  }

  return NextResponse.json({ ok: true, next: "done" });
});
