import { prisma } from "./prisma";

export type AuthEventAction =
  | "auth.login.success"
  | "auth.login.failed"
  | "auth.login.blocked"
  | "auth.logout"
  | "auth.access.forbidden"
  | "auth.session.invalid"; // UA binding mismatch — possible token theft

/**
 * Write an authentication event directly to the audit log.
 * Fire-and-forget — failures never break the request.
 */
export function logAuthEvent(opts: {
  action: AuthEventAction;
  userEmail?: string | null;
  userId?: string | null;
  ipAddress?: string | null;
}) {
  prisma.auditLog
    .create({
      data: {
        action: opts.action,
        model: "Auth",
        recordId: null,
        userId: opts.userId ?? null,
        userEmail: opts.userEmail ?? null,
        ipAddress: opts.ipAddress ?? null,
      },
    })
    .catch(() => {});
}
