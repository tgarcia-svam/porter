import crypto from "crypto";
import { prismaAdmin as prisma } from "./prisma-admin";

// Debounce window for lastSeenAt updates to avoid a DB write on every request
const TOUCH_DEBOUNCE_MS = 60 * 1000;

function hashNonce(nonce: string): string {
  return crypto.createHash("sha256").update(nonce).digest("hex");
}

/** Register a new session. Evicts the oldest session(s) if maxSessions > 0 and the
 *  user already has that many active sessions. */
export async function createSession(
  userId: string,
  nonce: string,
  maxSessions: number,
  ip?: string,
  ua?: string
): Promise<void> {
  if (maxSessions > 0) {
    const existing = await prisma.userSession.findMany({
      where:   { userId },
      orderBy: { lastSeenAt: "asc" },
      select:  { id: true },
    });
    const overflow = existing.length - maxSessions + 1;
    if (overflow > 0) {
      const toDelete = existing.slice(0, overflow).map((s) => s.id);
      await prisma.userSession.deleteMany({ where: { id: { in: toDelete } } });
    }
  }

  await prisma.userSession.create({
    data: {
      userId,
      tokenHash: hashNonce(nonce),
      ipAddress: ip ?? null,
      userAgent: ua ?? null,
    },
  });
}

/** Returns true if the session is still active, false if it was revoked.
 *  Updates lastSeenAt at most once per TOUCH_DEBOUNCE_MS to limit write pressure. */
export async function validateAndTouchSession(nonce: string): Promise<boolean> {
  const tokenHash = hashNonce(nonce);
  const session = await prisma.userSession.findUnique({ where: { tokenHash } });
  if (!session) return false;

  const shouldTouch = Date.now() - session.lastSeenAt.getTime() > TOUCH_DEBOUNCE_MS;
  if (shouldTouch) {
    await prisma.userSession.update({
      where: { tokenHash },
      data:  { lastSeenAt: new Date() },
    });
  }
  return true;
}

/** Remove a session row on sign-out. */
export async function revokeSession(nonce: string): Promise<void> {
  const tokenHash = hashNonce(nonce);
  await prisma.userSession.deleteMany({ where: { tokenHash } });
}
