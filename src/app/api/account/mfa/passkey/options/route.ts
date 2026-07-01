import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { apiBadRequest, withHandler } from "@/lib/api-error";
import { findValidToken } from "@/lib/auth-tokens";
import { buildRegistrationOptions, signChallenge, CHALLENGE_COOKIE } from "@/lib/webauthn";

/**
 * Begin passkey enrollment. Authorized by the single-use MFA_ENROLL token issued
 * right after a password is set. Returns WebAuthn registration options and stashes
 * the challenge in a signed httpOnly cookie for the confirm step.
 */

const Body = z.object({ enrollToken: z.string().min(1) });

export const POST = withHandler(async (req: NextRequest) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const valid = await findValidToken(parsed.data.enrollToken, "MFA_ENROLL");
  if (!valid) {
    return NextResponse.json(
      { error: "Enrollment session expired. Restart from your set-password link." },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: valid.userId },
    select: { id: true, email: true },
  });
  if (!user) return apiBadRequest("Account no longer exists.");

  const existing = await prisma.passkey.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });

  const options = await buildRegistrationOptions(user.id, user.email, existing);

  const res = NextResponse.json(options);
  res.cookies.set(CHALLENGE_COOKIE, signChallenge("reg", user.email, options.challenge), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 5 * 60,
  });
  return res;
});
