/**
 * Overdue-uploads monitoring for the admin App Usage report.
 *
 * "Overdue" reuses the schedule fulfilment rule (per org, every schema): for a
 * project's current outstanding due period, any assigned org that is still
 * missing a VALID upload for a schema is overdue for that (project, org, schema,
 * dueDate). This is a monitoring view — independent of the `overdueEnabled` email
 * opt-in — and surfaces only the current period (`lastDue`), not every
 * historically missed one.
 *
 * Admins can "Remove from List" an item, recorded in OverdueDismissal; dismissed
 * items are filtered out here. Everything runs via prismaAdmin (BYPASSRLS), gated
 * behind requireAdmin in the routes.
 */

import { Prisma } from "@prisma/client";
import { prismaAdmin } from "./prisma-admin";
import { computeOccurrences, utcDay, formatUtcDate } from "./upload-schedule";
import { missingSchemasForPeriod } from "./upload-schedule-service";

export type OverdueItem = {
  scheduleId: string;
  projectId: string;
  projectName: string;
  organizationId: string;
  organizationName: string;
  schemaId: string;
  schemaName: string;
  /** The outstanding due date (YYYY-MM-DD, UTC), also the dismissal period key. */
  dueDate: string;
};

/** Stable key for an overdue obligation / its dismissal. */
function itemKey(scheduleId: string, organizationId: string, schemaId: string, dueDate: string): string {
  return `${scheduleId}|${organizationId}|${schemaId}|${dueDate}`;
}

export async function listOverdueUploads(now: Date = new Date()): Promise<OverdueItem[]> {
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
            include: { organization: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });

  const items: OverdueItem[] = [];

  for (const schedule of schedules) {
    const schemas = schedule.project.schemas.map((sp) => sp.schema);
    const orgs = schedule.project.organizations.map((po) => po.organization);
    if (schemas.length === 0 || orgs.length === 0) continue;

    const { lastDue } = computeOccurrences(schedule, today);
    // Not overdue until the due date has strictly passed.
    if (today.getTime() <= lastDue.getTime()) continue;

    const dueDateStr = formatUtcDate(lastDue);

    for (const org of orgs) {
      const missing = await missingSchemasForPeriod(schedule, schemas, org.id, lastDue);
      for (const schema of missing) {
        items.push({
          scheduleId: schedule.id,
          projectId: schedule.projectId,
          projectName: schedule.project.name,
          organizationId: org.id,
          organizationName: org.name,
          schemaId: schema.id,
          schemaName: schema.name,
          dueDate: dueDateStr,
        });
      }
    }
  }

  if (items.length === 0) return items;

  // Filter out anything an admin has already dismissed.
  const scheduleIds = [...new Set(items.map((i) => i.scheduleId))];
  const dismissals = await prismaAdmin.overdueDismissal.findMany({
    where: { scheduleId: { in: scheduleIds } },
    select: { scheduleId: true, organizationId: true, schemaId: true, dueDate: true },
  });
  const dismissed = new Set(
    dismissals.map((d) => itemKey(d.scheduleId, d.organizationId, d.schemaId, formatUtcDate(d.dueDate)))
  );

  return items.filter(
    (i) => !dismissed.has(itemKey(i.scheduleId, i.organizationId, i.schemaId, i.dueDate))
  );
}

/**
 * Record an admin dismissal of one overdue obligation. Idempotent — a duplicate
 * (already-dismissed) key is treated as success.
 */
export async function dismissOverdue(opts: {
  scheduleId: string;
  organizationId: string;
  schemaId: string;
  dueDate: string; // YYYY-MM-DD
  dismissedByUserId?: string | null;
}): Promise<void> {
  try {
    await prismaAdmin.overdueDismissal.create({
      data: {
        scheduleId: opts.scheduleId,
        organizationId: opts.organizationId,
        schemaId: opts.schemaId,
        dueDate: utcDay(new Date(`${opts.dueDate}T00:00:00Z`)),
        dismissedByUserId: opts.dismissedByUserId ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    throw err;
  }
}
