import crypto from "crypto";
import type { AuthTokenPurpose } from "@prisma/client";
import { prismaAdmin as prisma } from "./prisma-admin";

/**
 * Single-use, hashed tokens backing the invite / password-reset / MFA-enrollment
 * flows. The raw token is returned once (emailed or handed to the client) and is
 * NEVER stored — only its SHA-256 hash lands in the DB, so a database leak yields
 * no usable links. Tokens are single-use (consumedAt) and time-boxed per purpose.
 */

export const TOKEN_TTL_MS: Record<AuthTokenPurpose, number> = {
  INVITE: 72 * 60 * 60 * 1000, // 72h — admin onboarding
  RESET: 60 * 60 * 1000,       // 1h  — self-service password reset
  MFA_ENROLL: 15 * 60 * 1000,  // 15m — short handoff right after setting a password
};

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Create a token for a user/purpose. Returns the raw token (to embed in a link or
 * pass back to the client). `secretEnc` carries the encrypted candidate TOTP
 * secret during MFA enrollment.
 */
export async function createAuthToken(opts: {
  userId: string;
  purpose: AuthTokenPurpose;
  secretEnc?: string | null;
}): Promise<{ rawToken: string; id: string }> {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const row = await prisma.authToken.create({
    data: {
      userId: opts.userId,
      tokenHash: hashToken(rawToken),
      purpose: opts.purpose,
      secretEnc: opts.secretEnc ?? null,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS[opts.purpose]),
    },
  });
  return { rawToken, id: row.id };
}

type ValidToken = {
  id: string;
  userId: string;
  purpose: AuthTokenPurpose;
  secretEnc: string | null;
};

/** Look up a live (unconsumed, unexpired) token for a purpose. Does not consume. */
export async function findValidToken(
  rawToken: string,
  purpose: AuthTokenPurpose
): Promise<ValidToken | null> {
  if (!rawToken) return null;
  const row = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (!row || row.purpose !== purpose) return null;
  if (row.consumedAt) return null;
  if (row.expiresAt < new Date()) return null;
  return { id: row.id, userId: row.userId, purpose: row.purpose, secretEnc: row.secretEnc };
}

/** Mark a token consumed (single-use). */
export async function consumeAuthToken(id: string): Promise<void> {
  await prisma.authToken.update({
    where: { id },
    data: { consumedAt: new Date() },
  });
}

/** Persist the encrypted candidate TOTP secret on an in-flight enrollment token. */
export async function setTokenSecret(id: string, secretEnc: string): Promise<void> {
  await prisma.authToken.update({ where: { id }, data: { secretEnc } });
}

/**
 * Invalidate all live tokens of a purpose for a user (e.g. when re-issuing an
 * invite, or after a successful reset) so older links can't be replayed.
 */
export async function invalidateUserTokens(
  userId: string,
  purpose: AuthTokenPurpose
): Promise<void> {
  await prisma.authToken.updateMany({
    where: { userId, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
}
