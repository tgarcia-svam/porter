import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { apiBadRequest, withHandler } from "@/lib/api-error";
import { findValidToken, setTokenSecret } from "@/lib/auth-tokens";
import { generateTotpSecret, buildOtpAuthUrl } from "@/lib/totp";
import { encryptSecret } from "@/lib/crypto-at-rest";

/**
 * Begin TOTP enrollment. Authorized by a single-use MFA_ENROLL token (issued right
 * after a password is set). Generates a fresh secret, stashes it ENCRYPTED on the
 * enrollment token (not yet on the user — only promoted on confirm), and returns
 * the otpauth URL + base32 secret for the client to render a QR code.
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
    select: { email: true },
  });
  if (!user) return apiBadRequest("Account no longer exists.");

  const secret = generateTotpSecret();
  await setTokenSecret(valid.id, encryptSecret(secret));

  return NextResponse.json({
    otpauthUrl: buildOtpAuthUrl(user.email, secret),
    secret, // shown as a manual-entry fallback alongside the QR
  });
});
