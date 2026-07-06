import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const mockPrisma = vi.hoisted(() => ({
  uploadSchedule: { findMany: vi.fn() },
  fileUpload: { findMany: vi.fn() },
  overdueDismissal: { findMany: vi.fn(), create: vi.fn() },
}));

vi.mock("../prisma-admin", () => ({ prismaAdmin: mockPrisma }));

import { listOverdueUploads, dismissOverdue } from "../overdue-service";

// A monthly (day 15) project, two schemas, one org.
function monthlySchedule(overrides: {
  orgs?: Array<{ id: string; name: string }>;
} = {}) {
  const orgs = overrides.orgs ?? [{ id: "o1", name: "Org One" }];
  return {
    id: "sch1",
    projectId: "p1",
    frequency: "MONTHLY" as const,
    weekday: null,
    dayOfMonth: 15,
    monthOfQuarter: null,
    monthOfYear: null,
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
  mockPrisma.overdueDismissal.findMany.mockReset();
  mockPrisma.overdueDismissal.create.mockReset();
  // Defaults: org missing everything, nothing dismissed.
  mockPrisma.fileUpload.findMany.mockResolvedValue([]);
  mockPrisma.overdueDismissal.findMany.mockResolvedValue([]);
});

describe("listOverdueUploads", () => {
  it("returns one item per missing schema once the due date has passed", async () => {
    mockPrisma.uploadSchedule.findMany.mockResolvedValue([monthlySchedule()]);
    // Due = Mar 15; now Mar 20 → overdue.
    const items = await listOverdueUploads(at("2024-03-20"));

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.schemaId).sort()).toEqual(["s1", "s2"]);
    expect(items[0]).toMatchObject({
      scheduleId: "sch1",
      projectId: "p1",
      projectName: "Proj",
      organizationId: "o1",
      organizationName: "Org One",
      dueDate: "2024-03-15",
    });
  });

  it("returns nothing on/before the due date (not yet overdue)", async () => {
    mockPrisma.uploadSchedule.findMany.mockResolvedValue([monthlySchedule()]);
    const items = await listOverdueUploads(at("2024-03-15")); // exactly due today
    expect(items).toEqual([]);
  });

  it("excludes a fulfilled org (uploaded every schema)", async () => {
    mockPrisma.uploadSchedule.findMany.mockResolvedValue([monthlySchedule()]);
    mockPrisma.fileUpload.findMany.mockResolvedValue([{ schemaId: "s1" }, { schemaId: "s2" }]);
    const items = await listOverdueUploads(at("2024-03-20"));
    expect(items).toEqual([]);
  });

  it("surfaces only the missing schema when one is uploaded", async () => {
    mockPrisma.uploadSchedule.findMany.mockResolvedValue([monthlySchedule()]);
    mockPrisma.fileUpload.findMany.mockResolvedValue([{ schemaId: "s1" }]);
    const items = await listOverdueUploads(at("2024-03-20"));
    expect(items).toHaveLength(1);
    expect(items[0].schemaId).toBe("s2");
  });

  it("filters out dismissed obligations", async () => {
    mockPrisma.uploadSchedule.findMany.mockResolvedValue([monthlySchedule()]);
    mockPrisma.overdueDismissal.findMany.mockResolvedValue([
      { scheduleId: "sch1", organizationId: "o1", schemaId: "s1", dueDate: new Date("2024-03-15T00:00:00Z") },
    ]);
    const items = await listOverdueUploads(at("2024-03-20"));
    expect(items).toHaveLength(1);
    expect(items[0].schemaId).toBe("s2");
  });
});

describe("dismissOverdue", () => {
  it("creates a dismissal row", async () => {
    mockPrisma.overdueDismissal.create.mockResolvedValue({});
    await dismissOverdue({ scheduleId: "sch1", organizationId: "o1", schemaId: "s1", dueDate: "2024-03-15" });
    expect(mockPrisma.overdueDismissal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ scheduleId: "sch1", organizationId: "o1", schemaId: "s1" }),
    });
  });

  it("treats a duplicate (P2002) as success", async () => {
    mockPrisma.overdueDismissal.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" })
    );
    await expect(
      dismissOverdue({ scheduleId: "sch1", organizationId: "o1", schemaId: "s1", dueDate: "2024-03-15" })
    ).resolves.toBeUndefined();
  });
});
