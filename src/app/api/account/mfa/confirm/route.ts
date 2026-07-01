import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { apiBadRequest, withHandler } from "@/lib/api-error";
import { findValidToken, consumeAuthToken } from "@/lib/auth-tokens";
import { verifyTotp } from "@/lib/totp";
import { decryptSecret } from "@/lib/crypto-at-rest";

/**
 * Complete TOTP enrollment. Verifies a code against the candidate secret stored on
 * the MFA_ENROLL token; on success promotes the (still-encrypted) secret onto the
 * user, enables MFA, and consumes the token. The account can now sign in.
 */

const Body = z.object({
  enrollToken: z.string().min(1),
  code: z.string().min(1),
});

export const POST = withHandler(async (req: NextRequest) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const valid = await findValidToken(parsed.data.enrollToken, "MFA_ENROLL");
  if (!valid || !valid.secretEnc) {
    return NextResponse.json(
      { error: "Enrollment session expired. Restart from your set-password link." },
      { status: 400 }
    );
  }

  const secret = decryptSecret(valid.secretEnc);
  if (!(await verifyTotp(parsed.data.code, secret))) {
    return NextResponse.json(
      { error: "That code didn't match. Check your authenticator app and try again." },
      { status: 422 }
    );
  }

  await prisma.user.update({
    where: { id: valid.userId },
    data: { mfaEnabled: true, mfaSecretEnc: valid.secretEnc },
  });
  await consumeAuthToken(valid.id);

  return NextResponse.json({ ok: true });
});
