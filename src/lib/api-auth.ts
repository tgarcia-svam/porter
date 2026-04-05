import { type NextRequest } from "next/server";
import { auth } from "./auth";
import { auditStore, clientIp } from "./audit-context";
import { logAuthEvent } from "./auth-audit";
import { verifySessionBinding } from "./session-binding";

/**
 * Shared admin guard for API routes.
 * - Verifies session binding (UA hash) to detect token theft.
 * - Logs auth.access.forbidden for unauthenticated or non-admin requests.
 * - Sets the audit context for authenticated admins so mutations are attributed.
 * Returns the session on success, null on failure.
 */
export async function requireAdmin(req?: NextRequest) {
  const session = await auth();
  const ip = req ? clientIp(req) : undefined;

  if (!session?.user) {
    logAuthEvent({ action: "auth.access.forbidden", ipAddress: ip });
    return null;
  }

  // Reject if the request's User-Agent doesn't match the one bound at sign-in
  if (req && !verifySessionBinding(session.user.uaHash, req)) {
    logAuthEvent({
      action: "auth.session.invalid",
      userId: session.user.id,
      userEmail: session.user.email,
      ipAddress: ip,
    });
    return null;
  }

  if (session.user.role !== "ADMIN") {
    logAuthEvent({
      action: "auth.access.forbidden",
      userId: session.user.id,
      userEmail: session.user.email,
      ipAddress: ip,
    });
    return null;
  }

  auditStore.enterWith({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    ip,
  });

  return session;
}
