/**
 * POST /api/projects/[id]/schedule/notify
 *
 * On-demand reminder for a single project. Sends reminder emails to every
 * organization in the project that has not yet uploaded all required schemas
 * for the upcoming period. Bypasses the date-based condition and idempotency
 * ledger — the admin is explicitly requesting a send now.
 *
 * Admin-only. Returns { sent, skipped }.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiUnauthorized, withHandler } from "@/lib/api-error";
import { sendProjectScheduleRemindersNow } from "@/lib/upload-schedule-service";

export const POST = withHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin(req);
    if (!session) return apiUnauthorized();

    const { id } = await params;
    const result = await sendProjectScheduleRemindersNow(id);

    console.log(
      `[schedules] manual reminder for project ${id} — sent=${result.sent} skipped=${result.skipped}`
    );

    return NextResponse.json(result);
  }
);
