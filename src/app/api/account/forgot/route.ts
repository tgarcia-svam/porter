import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { apiBadRequest, withHandler } from "@/lib/api-error";
import { createAuthToken, invalidateUserTokens } from "@/lib/auth-tokens";
import { sendResetEmail } from "@/lib/email";

/**
 * Self-service password reset request. Always returns a generic 200 regardless of
 * whether the email maps to a local account — no user enumeration. For a real
 * PASSWORD user it invalidates prior reset links and emails a fresh one.
 */

const Body = z.object({ email: z.string().email() });

export const POST = withHandler(async (req: NextRequest) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });

  if (user && user.authMethod === "PASSWORD") {
    await invalidateUserTokens(user.id, "RESET");
    const { rawToken } = await createAuthToken({ userId: user.id, purpose: "RESET" });
    try {
      await sendResetEmail(user.email, rawToken);
    } catch (err) {
      console.error("[account/forgot] failed to send reset email:", err);
    }
  }

  return NextResponse.json({ ok: true });
});
