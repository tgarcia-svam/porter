/**
 * POST /api/admin/schedules/run
 *
 * Evaluates every project upload schedule and sends any due reminder / overdue
 * emails. Two auth paths (mirrors /api/admin/retention/run):
 *   - Shared secret header `x-worker-secret` matches UPLOAD_WORKER_SECRET (used by
 *     the daily timer in the upload-worker Function App).
 *   - Admin session (used when an operator clicks "Run now" in the admin UI).
 *
 * Idempotent: the ScheduleNotification ledger prevents re-sending within a period,
 * so this is safe to trigger repeatedly.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiUnauthorized, withHandler } from "@/lib/api-error";
import { runScheduleNotifications } from "@/lib/upload-schedule-service";

function verifyWorkerSecret(req: NextRequest): boolean {
  const secret = process.env.UPLOAD_WORKER_SECRET;
  if (!secret) return false;
  return req.headers.get("x-worker-secret") === secret;
}

export const POST = withHandler(async (req: NextRequest) => {
  if (!verifyWorkerSecret(req)) {
    const session = await requireAdmin(req);
    if (!session) return apiUnauthorized();
  }

  const t0 = Date.now();
  const result = await runScheduleNotifications();
  console.log(
    `[schedules] ran in ${Date.now() - t0}ms — checked=${result.schedulesChecked} reminders=${result.remindersSent} overdue=${result.overdueSent}`
  );

  return NextResponse.json(result);
});
