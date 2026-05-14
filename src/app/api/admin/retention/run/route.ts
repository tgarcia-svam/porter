/**
 * POST /api/admin/retention/run
 *
 * Triggers a single retention sweep. Two auth paths:
 *   - Shared secret header `x-worker-secret` matches RETENTION_WORKER_SECRET
 *     (used by the Azure scheduled job that hits this daily).
 *   - Admin session (used when an operator clicks "Run now" in the admin UI).
 *
 * Returns counts of soft-deleted uploads, hard-deleted uploads, and
 * hard-deleted audit log rows, plus the settings that were applied.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiUnauthorized, withHandler } from "@/lib/api-error";
import { runRetention } from "@/lib/retention-service";

function verifyWorkerSecret(req: NextRequest): boolean {
  const secret = process.env.RETENTION_WORKER_SECRET;
  if (!secret) return false;
  return req.headers.get("x-worker-secret") === secret;
}

export const POST = withHandler(async (req: NextRequest) => {
  if (!verifyWorkerSecret(req)) {
    const session = await requireAdmin(req);
    if (!session) return apiUnauthorized();
  }

  const t0 = Date.now();
  const result = await runRetention();
  console.log(
    `[retention] ran in ${Date.now() - t0}ms — softDeleted=${result.uploadsSoftDeleted} hardDeleted=${result.uploadsHardDeleted} auditDeleted=${result.auditLogsDeleted}`
  );

  return NextResponse.json(result);
});
