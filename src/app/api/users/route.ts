import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, apiConflict, withHandler } from "@/lib/api-error";
import { createAuthToken } from "@/lib/auth-tokens";
import { sendInviteEmail } from "@/lib/email";

const CreateUserBody = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(["ADMIN", "UPLOADER"]).default("UPLOADER"),
  organizationId: z.string().optional().nullable(),
  // Admin chooses how the user signs in; username/password is the default.
  authMethod: z.enum(["PASSWORD", "SSO"]).default("PASSWORD"),
});

export const GET = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  // Never expose passwordHash / mfaSecretEnc — select only client-safe fields.
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      authMethod: true,
      mfaEnabled: true,
      lockedUntil: true,
      lockedForReset: true,
      failedLoginAttempts: true,
      organization: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(users);
});

export const POST = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const body = await req.json();
  const parsed = CreateUserBody.safeParse(body);
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const email = parsed.data.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return apiConflict("User already exists");

  const user = await prisma.user.create({ data: { ...parsed.data, email } });

  // For password users, email a single-use invite link to set their password and
  // enroll MFA. The admin never sees or handles a password.
  if (user.authMethod === "PASSWORD") {
    const { rawToken } = await createAuthToken({ userId: user.id, purpose: "INVITE" });
    try {
      await sendInviteEmail(user.email, rawToken);
    } catch (err) {
      console.error("[users] failed to send invite email:", err);
    }
  }

  return NextResponse.json(
    { id: user.id, email: user.email, authMethod: user.authMethod },
    { status: 201 }
  );
});
