/**
 * Upload-schedule notification job.
 *
 * For every project that has an UploadSchedule, this evaluates each organization
 * assigned to the project against the project's cadence and sends reminder /
 * overdue emails. Fulfillment is "per org, every schema": an org is caught up for
 * a period only when it has a VALID upload for EVERY schema in the project during
 * that period. Recipients are within-org only — an org that's behind is emailed
 * its own users; orgs never see each other's status.
 *
 * Idempotency: the ScheduleNotification table has a unique constraint on
 * (scheduleId, organizationId, dueDate, type). We insert the ledger row FIRST and
 * only send on a successful (non-duplicate) insert, so the daily timer can run
 * repeatedly without re-sending — at-most-once per org per period per type.
 *
 * Runs via prismaAdmin (BYPASSRLS); triggered by POST /api/admin/schedules/run
 * (the daily Function App timer, or an admin "Run now").
 */

import { Prisma } from "@prisma/client";
import { prismaAdmin } from "./prisma-admin";
import {
  computeOccurrences,
  periodStart,
  utcDay,
  addDays,
  formatUtcDate,
  type ScheduleShape,
} from "./upload-schedule";
import { sendUploadReminderEmail, sendUploadOverdueEmail } from "./email";

export type ScheduleRunResult = {
  ranAt: string;
  schedulesChecked: number;
  remindersSent: number;
  overdueSent: number;
};

export type ScheduleNotifyResult = {
  sent: number;
  skipped: number; // orgs with no missing uploads — nothing to remind
};

export type SchemaRef = { id: string; name: string };

/**
 * Schemas in the project still missing a VALID upload from `organizationId` for
 * the period ending at `due`. Empty ⇒ the org is fulfilled for that period.
 */
export async function missingSchemasForPeriod(
  schedule: ScheduleShape,
  schemas: SchemaRef[],
  organizationId: string,
  due: Date
): Promise<SchemaRef[]> {
  if (schemas.length === 0) return [];

  // Period = (day after the previous occurrence) … (end of the due day), so
  // consecutive periods neither overlap nor leave gaps.
  const start = addDays(periodStart(schedule, due), 1);
  const endExclusive = addDays(utcDay(due), 1);

  const uploads = await prismaAdmin.fileUpload.findMany({
    where: {
      schemaId: { in: schemas.map((s) => s.id) },
      status: "VALID",
      deletedAt: null,
      createdAt: { gte: start, lt: endExclusive },
      user: { organizationId },
    },
    select: { schemaId: true },
  });

  const present = new Set(uploads.map((u) => u.schemaId));
  return schemas.filter((s) => !present.has(s.id));
}

/**
 * Record the notification then report whether this call "won" the insert (i.e. it
 * had not been sent before). Returns false if a row already existed (P2002).
 */
async function claimNotification(
  scheduleId: string,
  organizationId: string,
  dueDate: Date,
  type: "REMINDER" | "OVERDUE"
): Promise<boolean> {
  try {
    await prismaAdmin.scheduleNotification.create({
      data: { scheduleId, organizationId, dueDate: utcDay(dueDate), type },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return false; // already sent for this (schedule, org, dueDate, type)
    }
    throw err;
  }
}

export async function runScheduleNotifications(
  now: Date = new Date()
): Promise<ScheduleRunResult> {
  const today = utcDay(now);

  const schedules = await prismaAdmin.uploadSchedule.findMany({
    where: { project: { deletedAt: null } },
    include: {
      project: {
        include: {
          schemas: {
            where: { schema: { deletedAt: null } },
            include: { schema: { select: { id: true, name: true } } },
          },
          organizations: {
            where: { organization: { deletedAt: null } },
            include: {
              organization: {
                include: { users: { select: { email: true } } },
              },
            },
          },
        },
      },
    },
  });

  let remindersSent = 0;
  let overdueSent = 0;

  for (const schedule of schedules) {
    const schemas: SchemaRef[] = schedule.project.schemas.map((sp) => sp.schema);
    const orgs = schedule.project.organizations.map((po) => po.organization);
    if (orgs.length === 0) continue;

    const { lastDue, upcomingDue } = computeOccurrences(schedule, today);

    const reminderActive =
      schedule.reminderEnabled &&
      schedule.reminderDaysBefore != null &&
      addDays(upcomingDue, -schedule.reminderDaysBefore).getTime() === today.getTime();

    // Overdue: the most-recent due date has strictly passed.
    const overdueActive = schedule.overdueEnabled && today.getTime() > lastDue.getTime();

    if (!reminderActive && !overdueActive) continue;

    for (const org of orgs) {
      const recipients = org.users.map((u) => u.email).filter(Boolean);
      if (recipients.length === 0) continue;

      if (reminderActive) {
        const missing = await missingSchemasForPeriod(schedule, schemas, org.id, upcomingDue);
        if (missing.length > 0 && (await claimNotification(schedule.id, org.id, upcomingDue, "REMINDER"))) {
          try {
            await sendUploadReminderEmail({
              recipients,
              projectName: schedule.project.name,
              dueDate: formatUtcDate(upcomingDue),
              daysBefore: schedule.reminderDaysBefore!,
              missingSchemas: missing.map((s) => s.name),
            });
            remindersSent++;
          } catch (err) {
            console.error(`[schedules] reminder email failed for org ${org.id}:`, err);
          }
        }
      }

      if (overdueActive) {
        const missing = await missingSchemasForPeriod(schedule, schemas, org.id, lastDue);
        if (missing.length > 0 && (await claimNotification(schedule.id, org.id, lastDue, "OVERDUE"))) {
          try {
            await sendUploadOverdueEmail({
              recipients,
              projectName: schedule.project.name,
              dueDate: formatUtcDate(lastDue),
              missingSchemas: missing.map((s) => s.name),
            });
            overdueSent++;
          } catch (err) {
            console.error(`[schedules] overdue email failed for org ${org.id}:`, err);
          }
        }
      }
    }
  }

  return {
    ranAt: new Date().toISOString(),
    schedulesChecked: schedules.length,
    remindersSent,
    overdueSent,
  };
}

/**
 * On-demand reminder for a single project. Bypasses the date-based condition
 * (reminderDaysBefore) and the idempotency ledger — the admin explicitly wants
 * to send now. Still skips orgs that have already uploaded every schema for the
 * upcoming period so we never spam an org that's already caught up.
 */
export async function sendProjectScheduleRemindersNow(
  projectId: string,
  now: Date = new Date()
): Promise<ScheduleNotifyResult> {
  const schedule = await prismaAdmin.uploadSchedule.findUnique({
    where: { projectId },
    include: {
      project: {
        include: {
          schemas: {
            where: { schema: { deletedAt: null } },
            include: { schema: { select: { id: true, name: true } } },
          },
          organizations: {
            where: { organization: { deletedAt: null } },
            include: {
              organization: {
                include: { users: { select: { email: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!schedule) return { sent: 0, skipped: 0 };

  const schemas: SchemaRef[] = schedule.project.schemas.map((sp) => sp.schema);
  const orgs = schedule.project.organizations.map((po) => po.organization);
  const today = utcDay(now);
  const { upcomingDue } = computeOccurrences(schedule, today);

  let sent = 0;
  let skipped = 0;

  for (const org of orgs) {
    const recipients = org.users.map((u) => u.email).filter(Boolean);
    if (recipients.length === 0) { skipped++; continue; }

    const missing = await missingSchemasForPeriod(schedule, schemas, org.id, upcomingDue);
    if (missing.length === 0) { skipped++; continue; }

    try {
      await sendUploadReminderEmail({
        recipients,
        projectName: schedule.project.name,
        dueDate: formatUtcDate(upcomingDue),
        daysBefore: Math.ceil(
          (upcomingDue.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        ),
        missingSchemas: missing.map((s) => s.name),
      });
      sent++;
    } catch (err) {
      console.error(`[schedules] manual reminder failed for org ${org.id}:`, err);
    }
  }

  return { sent, skipped };
}
