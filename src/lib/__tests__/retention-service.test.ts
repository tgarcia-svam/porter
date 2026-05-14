import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted runs alongside the (hoisted) vi.mock factory so the mock object
// is available when prisma-admin is imported by retention-service.
const mockPrisma = vi.hoisted(() => ({
  appSetting: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  fileUpload: {
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  auditLog: {
    deleteMany: vi.fn(),
  },
}));

vi.mock("../prisma-admin", () => ({ prismaAdmin: mockPrisma }));

import {
  getRetentionSettings,
  setRetentionSettings,
  runRetention,
  RETENTION_KEYS,
} from "../retention-service";

beforeEach(() => {
  for (const fn of Object.values(mockPrisma.appSetting)) fn.mockReset();
  for (const fn of Object.values(mockPrisma.fileUpload)) fn.mockReset();
  for (const fn of Object.values(mockPrisma.auditLog)) fn.mockReset();
});

// ── getRetentionSettings ─────────────────────────────────────────────────────

describe("getRetentionSettings", () => {
  it("defaults all keys to 0 (unlimited) when AppSetting is empty", async () => {
    mockPrisma.appSetting.findMany.mockResolvedValue([]);
    const s = await getRetentionSettings();
    expect(s).toEqual({
      uploadSoftDeleteDays: 0,
      uploadHardDeleteDays: 0,
      auditLogRetentionDays: 0,
    });
  });

  it("parses stored string values into numbers", async () => {
    mockPrisma.appSetting.findMany.mockResolvedValue([
      { key: RETENTION_KEYS.UPLOAD_SOFT_DELETE_DAYS, value: "30" },
      { key: RETENTION_KEYS.UPLOAD_HARD_DELETE_DAYS, value: "90" },
      { key: RETENTION_KEYS.AUDIT_LOG_RETENTION_DAYS, value: "365" },
    ]);
    const s = await getRetentionSettings();
    expect(s).toEqual({
      uploadSoftDeleteDays: 30,
      uploadHardDeleteDays: 90,
      auditLogRetentionDays: 365,
    });
  });

  it("treats invalid stored values as 0 (unlimited)", async () => {
    mockPrisma.appSetting.findMany.mockResolvedValue([
      { key: RETENTION_KEYS.UPLOAD_SOFT_DELETE_DAYS, value: "abc" },
      { key: RETENTION_KEYS.UPLOAD_HARD_DELETE_DAYS, value: "-5" },
    ]);
    const s = await getRetentionSettings();
    expect(s.uploadSoftDeleteDays).toBe(0);
    expect(s.uploadHardDeleteDays).toBe(0);
  });
});

// ── setRetentionSettings ─────────────────────────────────────────────────────

describe("setRetentionSettings", () => {
  it("upserts only the provided fields", async () => {
    mockPrisma.appSetting.upsert.mockResolvedValue({});
    mockPrisma.appSetting.findMany.mockResolvedValue([]);

    await setRetentionSettings({ uploadSoftDeleteDays: 14 });

    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: RETENTION_KEYS.UPLOAD_SOFT_DELETE_DAYS },
      update: { value: "14" },
      create: { key: RETENTION_KEYS.UPLOAD_SOFT_DELETE_DAYS, value: "14" },
    });
  });

  it("clamps negative values to 0", async () => {
    mockPrisma.appSetting.upsert.mockResolvedValue({});
    mockPrisma.appSetting.findMany.mockResolvedValue([]);

    await setRetentionSettings({ uploadHardDeleteDays: -10 });

    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { value: "0" },
        create: expect.objectContaining({ value: "0" }),
      })
    );
  });

  it("floors fractional input", async () => {
    mockPrisma.appSetting.upsert.mockResolvedValue({});
    mockPrisma.appSetting.findMany.mockResolvedValue([]);

    await setRetentionSettings({ auditLogRetentionDays: 7.9 });

    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: "7" } })
    );
  });
});

// ── runRetention ─────────────────────────────────────────────────────────────

describe("runRetention", () => {
  it("does nothing when all settings are 0 (unlimited)", async () => {
    mockPrisma.appSetting.findMany.mockResolvedValue([]);

    const r = await runRetention();

    expect(r.uploadsSoftDeleted).toBe(0);
    expect(r.uploadsHardDeleted).toBe(0);
    expect(r.auditLogsDeleted).toBe(0);
    expect(mockPrisma.fileUpload.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.fileUpload.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it("soft-deletes uploads older than N days, skipping already-deleted rows", async () => {
    mockPrisma.appSetting.findMany.mockResolvedValue([
      { key: RETENTION_KEYS.UPLOAD_SOFT_DELETE_DAYS, value: "30" },
    ]);
    mockPrisma.fileUpload.updateMany.mockResolvedValue({ count: 7 });

    const before = Date.now();
    const r = await runRetention();
    const after = Date.now();

    expect(r.uploadsSoftDeleted).toBe(7);
    const call = mockPrisma.fileUpload.updateMany.mock.calls[0][0];
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);

    // Cutoff should be ~30 days before "now"
    const cutoffMs = call.where.createdAt.lt.getTime();
    const expectedMin = before - 30 * 86_400_000;
    const expectedMax = after - 30 * 86_400_000;
    expect(cutoffMs).toBeGreaterThanOrEqual(expectedMin);
    expect(cutoffMs).toBeLessThanOrEqual(expectedMax);
  });

  it("hard-deletes uploads older than M days regardless of soft-delete state", async () => {
    mockPrisma.appSetting.findMany.mockResolvedValue([
      { key: RETENTION_KEYS.UPLOAD_HARD_DELETE_DAYS, value: "90" },
    ]);
    mockPrisma.fileUpload.deleteMany.mockResolvedValue({ count: 3 });

    const r = await runRetention();

    expect(r.uploadsHardDeleted).toBe(3);
    const call = mockPrisma.fileUpload.deleteMany.mock.calls[0][0];
    // No deletedAt filter — hard-delete sweeps everything past the cutoff
    expect(call.where.deletedAt).toBeUndefined();
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);
  });

  it("hard-deletes audit logs older than retention days", async () => {
    mockPrisma.appSetting.findMany.mockResolvedValue([
      { key: RETENTION_KEYS.AUDIT_LOG_RETENTION_DAYS, value: "365" },
    ]);
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 1024 });

    const r = await runRetention();

    expect(r.auditLogsDeleted).toBe(1024);
    const call = mockPrisma.auditLog.deleteMany.mock.calls[0][0];
    expect(call.where.timestamp.lt).toBeInstanceOf(Date);
  });

  it("runs all three sweeps together when all settings are configured", async () => {
    mockPrisma.appSetting.findMany.mockResolvedValue([
      { key: RETENTION_KEYS.UPLOAD_SOFT_DELETE_DAYS, value: "30" },
      { key: RETENTION_KEYS.UPLOAD_HARD_DELETE_DAYS, value: "90" },
      { key: RETENTION_KEYS.AUDIT_LOG_RETENTION_DAYS, value: "365" },
    ]);
    mockPrisma.fileUpload.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.fileUpload.deleteMany.mockResolvedValue({ count: 5 });
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 8 });

    const r = await runRetention();

    expect(r).toMatchObject({
      uploadsSoftDeleted: 2,
      uploadsHardDeleted: 5,
      auditLogsDeleted: 8,
      settings: {
        uploadSoftDeleteDays: 30,
        uploadHardDeleteDays: 90,
        auditLogRetentionDays: 365,
      },
    });
    expect(r.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
