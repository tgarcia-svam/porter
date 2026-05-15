import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, withHandler } from "@/lib/api-error";
import { getRetentionSettings, setRetentionSettings } from "@/lib/retention-service";

const UpdateBody = z.object({
  uploadSoftDeleteDays: z.number().int().min(0).optional(),
  uploadHardDeleteDays: z.number().int().min(0).optional(),
  auditLogRetentionDays: z.number().int().min(0).optional(),
});

export const GET = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();
  return NextResponse.json(await getRetentionSettings());
});

export const PUT = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const body = await req.json();
  const parsed = UpdateBody.safeParse(body);
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  // Reject contradictory M < N (would soft-delete then immediately hard-delete).
  const settings = await getRetentionSettings();
  const next = { ...settings, ...parsed.data };
  if (
    next.uploadHardDeleteDays > 0 &&
    next.uploadSoftDeleteDays > 0 &&
    next.uploadHardDeleteDays < next.uploadSoftDeleteDays
  ) {
    return apiBadRequest(
      "uploadHardDeleteDays must be >= uploadSoftDeleteDays (or 0 to disable)"
    );
  }

  return NextResponse.json(await setRetentionSettings(parsed.data));
});
