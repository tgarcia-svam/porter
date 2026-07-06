import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { dismissOverdue } from "@/lib/overdue-service";
import { apiUnauthorized, apiBadRequest, withHandler } from "@/lib/api-error";

const Body = z.object({
  scheduleId: z.string().min(1),
  organizationId: z.string().min(1),
  schemaId: z.string().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD"),
});

/**
 * POST /api/admin/overdue/dismiss
 * Marks one overdue obligation (schedule + org + schema + due period) as no
 * longer overdue so it drops off the report. Idempotent.
 */
export const POST = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiUnauthorized();

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  await dismissOverdue({ ...parsed.data, dismissedByUserId: session.user?.id ?? null });
  return NextResponse.json({ ok: true });
});
