/**
 * GET / PUT / DELETE /api/projects/[id]/schedule
 *
 * Admin-only CRUD for a project's upload cadence (UploadSchedule, 1:1 with the
 * project). PUT upserts; DELETE removes the schedule so the project reverts to
 * "no cadence". GET returns the schedule (or null) plus the computed next due
 * date for the admin UI preview.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, apiNotFound, withHandler } from "@/lib/api-error";
import { nextDueDate, formatUtcDate, type ScheduleShape } from "@/lib/upload-schedule";

// Per-frequency validation: only the fields the frequency uses are required, and
// reminderDaysBefore is required (>=1) when reminders are enabled.
const ScheduleBody = z
  .object({
    frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
    weekday: z.number().int().min(0).max(6).nullish(),
    dayOfMonth: z.number().int().min(1).max(31).nullish(),
    monthOfQuarter: z.number().int().min(1).max(3).nullish(),
    monthOfYear: z.number().int().min(1).max(12).nullish(),
    reminderEnabled: z.boolean().default(false),
    reminderDaysBefore: z.number().int().min(1).max(365).nullish(),
    overdueEnabled: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    const require = (cond: boolean, path: string, message: string) => {
      if (!cond) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    if (v.frequency === "WEEKLY") require(v.weekday != null, "weekday", "weekday is required for weekly schedules");
    if (v.frequency === "MONTHLY") require(v.dayOfMonth != null, "dayOfMonth", "dayOfMonth is required for monthly schedules");
    if (v.frequency === "QUARTERLY") {
      require(v.monthOfQuarter != null, "monthOfQuarter", "monthOfQuarter is required for quarterly schedules");
      require(v.dayOfMonth != null, "dayOfMonth", "dayOfMonth is required for quarterly schedules");
    }
    if (v.frequency === "YEARLY") {
      require(v.monthOfYear != null, "monthOfYear", "monthOfYear is required for yearly schedules");
      require(v.dayOfMonth != null, "dayOfMonth", "dayOfMonth is required for yearly schedules");
    }
    if (v.reminderEnabled) require(v.reminderDaysBefore != null, "reminderDaysBefore", "reminderDaysBefore is required when reminders are enabled");
  });

function withNextDue<T extends ScheduleShape>(schedule: T) {
  return { ...schedule, nextDueDate: formatUtcDate(nextDueDate(schedule, new Date())) };
}

export const GET = withHandler<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const { id } = await params;
  const schedule = await prisma.uploadSchedule.findUnique({ where: { projectId: id } });
  return NextResponse.json(schedule ? withNextDue(schedule) : null);
});

export const PUT = withHandler<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.deletedAt) return apiNotFound();

  const parsed = ScheduleBody.safeParse(await req.json());
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const d = parsed.data;
  // Persist only the cadence fields relevant to the chosen frequency; null the rest.
  const data = {
    frequency: d.frequency,
    weekday: d.frequency === "WEEKLY" ? d.weekday ?? null : null,
    dayOfMonth: d.frequency === "WEEKLY" ? null : d.dayOfMonth ?? null,
    monthOfQuarter: d.frequency === "QUARTERLY" ? d.monthOfQuarter ?? null : null,
    monthOfYear: d.frequency === "YEARLY" ? d.monthOfYear ?? null : null,
    reminderEnabled: d.reminderEnabled,
    reminderDaysBefore: d.reminderEnabled ? d.reminderDaysBefore ?? null : null,
    overdueEnabled: d.overdueEnabled,
  };

  const schedule = await prisma.uploadSchedule.upsert({
    where: { projectId: id },
    create: { projectId: id, ...data },
    update: data,
  });

  return NextResponse.json(withNextDue(schedule));
});

export const DELETE = withHandler<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const { id } = await params;
  await prisma.uploadSchedule.deleteMany({ where: { projectId: id } });
  return new NextResponse(null, { status: 204 });
});
