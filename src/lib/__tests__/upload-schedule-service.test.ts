import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const mockPrisma = vi.hoisted(() => ({
  uploadSchedule: { findMany: vi.fn() },
  fileUpload: { findMany: vi.fn() },
  scheduleNotification: { create: vi.fn() },
}));

vi.mock("../prisma-admin", () => ({ prismaAdmin: mockPrisma }));
vi.mock("../email", () => ({
  sendUploadReminderEmail: vi.fn(),
  sendUploadOverdueEmail: vi.fn(),
}));

import { runScheduleNotifications } from "../upload-schedule-service";
import { sendUploadReminderEmail, sendUploadOverdueEmail } from "../email";

const reminderMock = vi.mocked(sendUploadReminderEmail);
const overdueMock = vi.mocked(sendUploadOverdueEmail);

// A monthly (day 15) project with two schemas and one org (one user).
function monthlySchedule(overrides: {
  reminderEnabled?: boolean;
  reminderDaysBefore?: number | null;
  overdueEnabled?: boolean;
  orgs?: Array<{ id: string; users: Array<{ email: string }> }>;
} = {}) {
  const orgs = overrides.orgs ?? [{ id: "o1", users: [{ email: "a@x.com" }] }];
  return {
    id: "sch1",
    frequency: "MONTHLY" as const,
    weekday: null,
    dayOfMonth: 15,
    monthOfQuarter: null,
    monthOfYear: null,
    reminderEnabled: overrides.reminderEnabled ?? false,
    reminderDaysBefore: overrides.reminderDaysBefore ?? null,
    overdueEnabled: overrides.overdueEnabled ?? false,
    project: {
      name: "Proj",
      schemas: [
        { schema: { id: "s1", name: "Schema One" } },
        { schema: { id: "s2", name: "Schema Two" } },
      ],
      organizations: orgs.map((o) => ({ organization: o })),
    },
  };
}

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

beforeEach(() => {
  mockPrisma.uploadSchedule.findMany.mockReset();
  mockPrisma.fileUpload.findMany.mockReset();
  mockPrisma.scheduleNotification.create.mockReset();
  reminderMock.mockReset();
  overdueMock.mockReset();
  // Default: nothing uploaded (org missing everything), ledger insert succeeds.
  mockPrisma.fileUpload.findMany.mockResolvedValue([]);
  mockPrisma.scheduleNotification.create.mockResolvedValue({});
});

describe("runScheduleNotifications — reminders", () => {
  it("sends a reminder in-window when the org is missing schemas", async () => {
    mockPrisma.uploadSchedule.findMany.mockResolvedValue([
      monthlySchedule({ reminderEnabled: true, reminderDaysBefore: 2 }),
    ]);
    // Due = Mar 15; reminder day = Mar 13.
    const r = await runScheduleNotifications(at("2024-03-13"));

    expect(r.remindersSent).toBe(1);
    expect(reminderMock).toHaveBeenCalledTimes(1);
    expect(reminderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: ["a@x.com"],
        projectName: "Proj",
        dueDate: "2024-03-15",
        daysBefore: 2,
        missingSchemas: ["Schema One", "Schema Two"],
      })
    );
    // Ledger row claimed for the upcoming due date.
    expect(mockPrisma.scheduleNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ scheduleId: "sch1", organizationId: "o1", type: "REMINDER" }),
    });
  });

  it("does not send when the org has uploaded every schema", async () => {
    mockPrisma.uploadSchedule.findMany.mockResolvedValue([
      monthlySchedule({ reminderEnabled: true, reminderDaysBefore: 2 }),
    ]);
    mockPrisma.fileUpload.findMany.mockResolvedValue([{ schemaId: "s1" }, { schemaId: "s2" }]);

    const r = await runScheduleNotifications(at("2024-03-13"));

    expect(r.remindersSent).toBe(0);
    expect(reminderMock).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleNotification.create).not.toHaveBeenCalled();
  });

  it("still sends when only one of several schemas is missing (every-schema rule)", async () => {
    mockPrisma.uploadSchedule.findMany.mockResolvedValue([
      monthlySchedule({ reminderEnabled: true, reminderDaysBefore: 2 }),
    ]);
    mockPrisma.fileUpload.findMany.mockResolvedValue([{ schemaId: "s1" }]);

    await runScheduleNotifications(at("2024-03-13"));

    expect(reminderMock).toHaveBeenCalledWith(
      expect.objectContaining({ missingSchemas: ["Schema Two"] })
    );
  });

  it("does not send outside the reminder window", async () => {
    mockPrisma.uploadSchedule.findMany.mockResolvedValue([
      monthlySchedule({ reminderEnabled: true, reminderDaysBefore: 2 }),
    ]);
    const r = await runScheduleNotifications(at("2024-03-10")); // 5 days before, not the reminder day

    expect(r.remindersSent).toBe(0);
    expect(reminderMock).not.toHaveBeenCalled();
  });

  it("does not re-send when the ledger row already exists (dedupe)", async () => {
    mockPrisma.uploadSchedule.findMany.mockResolvedValue([
      monthlySchedule({ reminderEnabled: true, reminderDaysBefore: 2 }),
    ]);
    mockPrisma.scheduleNotification.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" })
    );

    const r = await runScheduleNotifications(at("2024-03-13"));

    expect(r.remindersSent).toBe(0);
    expect(reminderMock).not.toHaveBeenCalled();
  });
});

describe("runScheduleNotifications — overdue", () => {
  it("sends an overdue notice after the due date when unfulfilled", async () => {
    mockPrisma.uploadSchedule.findMany.mockResolvedValue([
      monthlySchedule({ overdueEnabled: true }),
    ]);
    // Due = Mar 15; now Mar 20 → overdue for the Mar 15 period.
    const r = await runScheduleNotifications(at("2024-03-20"));

    expect(r.overdueSent).toBe(1);
    expect(overdueMock).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: "2024-03-15", missingSchemas: ["Schema One", "Schema Two"] })
    );
    expect(mockPrisma.scheduleNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "OVERDUE" }),
    });
  });

  it("does not fire overdue on the due date itself", async () => {
    mockPrisma.uploadSchedule.findMany.mockResolvedValue([
      monthlySchedule({ overdueEnabled: true }),
    ]);
    const r = await runScheduleNotifications(at("2024-03-15"));

    expect(r.overdueSent).toBe(0);
    expect(overdueMock).not.toHaveBeenCalled();
  });
});

describe("runScheduleNotifications — within-org recipients", () => {
  it("emails only the org that is behind, never the fulfilled org", async () => {
    mockPrisma.uploadSchedule.findMany.mockResolvedValue([
      monthlySchedule({
        reminderEnabled: true,
        reminderDaysBefore: 2,
        orgs: [
          { id: "o1", users: [{ email: "a@x.com" }, { email: "b@x.com" }] },
          { id: "o2", users: [{ email: "c@y.com" }] },
        ],
      }),
    ]);
    // o1 missing everything; o2 fulfilled.
    mockPrisma.fileUpload.findMany.mockImplementation((args: { where: { user: { organizationId: string } } }) => {
      return Promise.resolve(
        args.where.user.organizationId === "o2" ? [{ schemaId: "s1" }, { schemaId: "s2" }] : []
      );
    });

    const r = await runScheduleNotifications(at("2024-03-13"));

    expect(r.remindersSent).toBe(1);
    expect(reminderMock).toHaveBeenCalledTimes(1);
    // Only o1's users, together — o2's users are never included.
    expect(reminderMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipients: ["a@x.com", "b@x.com"] })
    );
  });
});
