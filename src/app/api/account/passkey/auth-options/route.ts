import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { apiBadRequest, withHandler } from "@/lib/api-error";
import { verifyPendingTicket } from "@/lib/login-ticket";
import { buildAuthenticationOptions, signChallenge, CHALLENGE_COOKIE } from "@/lib/webauthn";

/**
 * Issue WebAuthn authentication options for the passkey login step. Authorized by
 * the pending ticket from the password step (so we don't re-check the password).
 * The challenge is returned to the client AND stashed in a signed httpOnly cookie
 * for the subsequent /api/account/login passkey verification.
 */

const Body = z.object({
  email: z.string().email(),
  pendingTicket: z.string().min(1),
});

export const POST = withHandler(async (req: NextRequest) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const email = parsed.data.email.toLowerCase();
  if (verifyPendingTicket(parsed.data.pendingTicket) !== email) {
    return NextResponse.json({ error: "Session expired. Start over." }, { status: 401 });
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Session expired. Start over." }, { status: 401 });

  const passkeys = await prisma.passkey.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });
  if (passkeys.length === 0) {
    return NextResponse.json({ error: "No passkey registered." }, { status: 400 });
  }

  const options = await buildAuthenticationOptions(passkeys);

  const res = NextResponse.json(options);
  res.cookies.set(CHALLENGE_COOKIE, signChallenge("auth", email, options.challenge), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 5 * 60,
  });
  return res;
});
