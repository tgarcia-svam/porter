import { AsyncLocalStorage } from "node:async_hooks";

export type AuditCtx = {
  userId?: string;
  userEmail?: string;
  ip?: string;
};

/**
 * Stores per-request audit context (actor identity + IP) so the Prisma
 * extension can attach it to every DB mutation without threading it through
 * every call site.
 *
 * Usage in a route handler:
 *   auditStore.enterWith({ userId: session.user.id, userEmail: session.user.email, ip });
 */
export const auditStore = new AsyncLocalStorage<AuditCtx>();

/** Convenience: extract a best-effort client IP from a Request's headers. */
export function clientIp(req: Request): string | undefined {
  // Use the last hop: Azure App Service appends the real client IP at the end
  // of any existing X-Forwarded-For chain, so [0] is attacker-controlled.
  return (
    req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}
