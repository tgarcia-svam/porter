import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { apiBadRequest, withHandler } from "@/lib/api-error";
import { findValidToken, consumeAuthToken } from "@/lib/auth-tokens";
import {
  verifyRegistration,
  readChallenge,
  CHALLENGE_COOKIE,
  type RegistrationResponse,
} from "@/lib/webauthn";

/**
 * Complete passkey enrollment. Verifies the attestation against the challenge
 * cookie, stores the credential (public key + counter — no secret), and consumes
 * the MFA_ENROLL token. A stored passkey satisfies the account's MFA requirement.
 */

const Body = z.object({
  enrollToken: z.string().min(1),
  response: z.unknown(),
  deviceName: z.string().max(60).optional(),
});

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

  const challenge = readChallenge(req.cookies.get(CHALLENGE_COOKIE)?.value, "reg", user.email);
  if (!challenge) {
    return NextResponse.json(
      { error: "Enrollment session expired. Restart from your set-password link." },
      { status: 400 }
    );
  }

  const reg = await verifyRegistration(parsed.data.response as RegistrationResponse, challenge);
  if (!reg) {
    return NextResponse.json(
      { error: "Could not verify that passkey. Try again." },
      { status: 422 }
    );
  }

  await prisma.passkey.create({
    data: {
      userId: user.id,
      credentialId: reg.credentialId,
      publicKey: reg.publicKey,
      counter: reg.counter,
      transports: reg.transports,
      deviceName: parsed.data.deviceName ?? null,
    },
  });
  await consumeAuthToken(valid.id);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(CHALLENGE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});
