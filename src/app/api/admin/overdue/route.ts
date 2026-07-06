import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { listOverdueUploads } from "@/lib/overdue-service";
import { apiUnauthorized, withHandler } from "@/lib/api-error";

/**
 * GET /api/admin/overdue
 * Admin cross-org list of currently-overdue upload obligations (undismissed).
 */
export const GET = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiUnauthorized();

  const items = await listOverdueUploads();
  return NextResponse.json({ items });
});
