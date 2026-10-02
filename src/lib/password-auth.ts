import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { prismaAdmin as prisma } from "./prisma-admin";
import { logAuthEvent } from "./auth-audit";

/**
 * Password hashing + the two-tier account-lockout state machine for local
 * (username/password) accounts. This is the single source of truth for credential
 * verification side-effects; the /api/account/login route drives it.
 *
 * Lockout (per requirements):
 *   - 5 consecutive failures within a 15-minute window  → 15-minute cooldown
 *     (lockedUntil). The window is tracked via lastFailedLoginAt; a failure more
 *     than 15 minutes after the previous one starts a fresh count.
 *   - 8 consecutive failures                            → hard lock (lockedForReset)
 *     until the user completes a password reset. 8 satisfies the "≥8, ≤10" rule.
 *
 * Passwords are bcrypt-hashed (one-way) — never stored or logged in clear.
 */

const BCRYPT_COST = 12;

export const FAILURE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const TEMP_LOCK_THRESHOLD = 5;
export const TEMP_LOCK_MS = 15 * 60 * 1000;      // 15 minutes
export const HARD_LOCK_THRESHOLD = 8;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

export type LockState =
  | { locked: false }
  | { locked: true; reason: "locked_temp"; retryAfterSec: number }
  | { locked: true; reason: "locked_reset" };

/** Inspect a user's lockout state without mutating it. */
export function getLockState(
  user: Pick<User, "lockedForReset" | "lockedUntil">
): LockState {
  if (user.lockedForReset) return { locked: true, reason: "locked_reset" };
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const retryAfterSec = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    return { locked: true, reason: "locked_temp", retryAfterSec };
  }
  return { locked: false };
}

/**
 * Record a failed credential/MFA attempt and advance the lockout state. Returns
 * the resulting lock state so the caller can shape its response.
 */
export async function recordFailedAttempt(
  user: Pick<User, "id" | "email" | "failedLoginAttempts" | "lastFailedLoginAt">
): Promise<LockState> {
  const now = Date.now();
  const withinWindow =
    user.lastFailedLoginAt && now - user.lastFailedLoginAt.getTime() < FAILURE_WINDOW_MS;
  const newCount = (withinWindow ? user.failedLoginAttempts : 0) + 1;

  const data: {
    failedLoginAttempts: number;
    lastFailedLoginAt: Date;
    lockedUntil?: Date;
    lockedForReset?: boolean;
  } = {
    failedLoginAttempts: newCount,
    lastFailedLoginAt: new Date(now),
  };

  let state: LockState = { locked: false };

  if (newCount >= HARD_LOCK_THRESHOLD) {
    data.lockedForReset = true;
    state = { locked: true, reason: "locked_reset" };
    logAuthEvent({ action: "auth.login.blocked", userId: user.id, userEmail: user.email });
  } else if (newCount >= TEMP_LOCK_THRESHOLD) {
    data.lockedUntil = new Date(now + TEMP_LOCK_MS);
    state = { locked: true, reason: "locked_temp", retryAfterSec: Math.ceil(TEMP_LOCK_MS / 1000) };
    logAuthEvent({ action: "auth.login.blocked", userId: user.id, userEmail: user.email });
  } else {
    logAuthEvent({ action: "auth.login.failed", userId: user.id, userEmail: user.email });
  }

  await prisma.user.update({ where: { id: user.id }, data });
  return state;
}

/** Clear all failure/lock state after a successful sign-in and stamp new login metadata.
 *  Shifts lastLoginAt → prevLoginAt so the banner can show the prior session time. */
export async function recordSuccess(
  user: Pick<User, "id" | "email" | "failedLoginAttempts" | "lockedUntil" | "lastLoginAt" | "lastLoginIp">,
  ip?: string
): Promise<void> {
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts:          0,
      lastFailedLoginAt:            null,
      lockedUntil:                  null,
      prevLoginAt:                  user.lastLoginAt,
      prevLoginIp:                  user.lastLoginIp,
      lastLoginAt:                  new Date(),
      lastLoginIp:                  ip ?? null,
      failedAttemptsSinceLastLogin: user.failedLoginAttempts,
    },
  });
  logAuthEvent({ action: "auth.login.success", userId: user.id, userEmail: user.email });
}

/**
 * Clear lockout state on a successful password reset — including the hard
 * lockedForReset lock, which only a reset can release.
 */
export async function clearLockoutForReset(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
      lockedUntil: null,
      lockedForReset: false,
    },
  });
}
