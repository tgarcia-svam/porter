import bcrypt from "bcryptjs";
import { prismaAdmin as prisma } from "./prisma-admin";

// Maximum entries retained per user regardless of current policy, so that
// tightening the history count later still has data to check against.
const MAX_HISTORY_STORED = 24;

/**
 * Check whether `newPassword` matches any of the user's recent password
 * hashes (including their current password hash if supplied).
 *
 * Returns true when the password should be rejected (already in history).
 */
export async function isPasswordInHistory(
  userId:      string,
  newPassword: string,
  checkCount:  number,
  currentHash: string | null | undefined
): Promise<boolean> {
  // Always reject if it matches the current password (even when history is off).
  if (currentHash) {
    try {
      if (await bcrypt.compare(newPassword, currentHash)) return true;
    } catch { /* malformed hash — treat as no match */ }
  }

  if (checkCount <= 0) return false;

  const history = await prisma.passwordHistory.findMany({
    where:   { userId },
    orderBy: { createdAt: "desc" },
    take:    checkCount,
    select:  { passwordHash: true },
  });

  for (const entry of history) {
    try {
      if (await bcrypt.compare(newPassword, entry.passwordHash)) return true;
    } catch { /* skip malformed entries */ }
  }

  return false;
}

/**
 * Persist a new bcrypt hash in PasswordHistory and prune the oldest entries
 * beyond MAX_HISTORY_STORED so the table stays bounded.
 */
export async function recordPasswordHistory(
  userId:       string,
  passwordHash: string
): Promise<void> {
  await prisma.passwordHistory.create({
    data: { userId, passwordHash },
  });

  // Prune: keep only the most recent MAX_HISTORY_STORED entries.
  const old = await prisma.passwordHistory.findMany({
    where:   { userId },
    orderBy: { createdAt: "desc" },
    skip:    MAX_HISTORY_STORED,
    select:  { id: true },
  });
  if (old.length > 0) {
    await prisma.passwordHistory.deleteMany({
      where: { id: { in: old.map((e) => e.id) } },
    });
  }
}
