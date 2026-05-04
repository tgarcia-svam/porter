import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../prisma", () => ({
  prisma: {
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { logAuthEvent } from "../auth-audit";
import { prisma } from "../prisma";

const mockCreate = vi.mocked(prisma.auditLog.create);

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({} as never);
});

// ── logAuthEvent ──────────────────────────────────────────────────────────────

describe("logAuthEvent", () => {
  it("calls prisma.auditLog.create with the correct action and model", () => {
    logAuthEvent({ action: "auth.login.success", userId: "u1", userEmail: "a@b.com" });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "auth.login.success",
        model: "Auth",
        userId: "u1",
        userEmail: "a@b.com",
      }),
    });
  });

  it.each([
    "auth.login.success",
    "auth.login.failed",
    "auth.login.blocked",
    "auth.logout",
    "auth.access.forbidden",
    "auth.session.invalid",
  ] as const)("accepts action %s without throwing", (action) => {
    expect(() => logAuthEvent({ action })).not.toThrow();
  });

  it("sets recordId to null", () => {
    logAuthEvent({ action: "auth.logout" });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ recordId: null }),
    });
  });

  it("coerces undefined optional fields to null", () => {
    logAuthEvent({ action: "auth.access.forbidden" });
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.userId).toBeNull();
    expect(data.userEmail).toBeNull();
    expect(data.ipAddress).toBeNull();
  });

  it("passes ipAddress when provided", () => {
    logAuthEvent({ action: "auth.session.invalid", ipAddress: "10.0.0.1" });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ ipAddress: "10.0.0.1" }),
    });
  });

  it("does not throw when prisma.auditLog.create rejects", async () => {
    mockCreate.mockRejectedValueOnce(new Error("DB down"));
    expect(() => logAuthEvent({ action: "auth.logout" })).not.toThrow();
    // Allow the micro-task rejection to be swallowed
    await new Promise((r) => setTimeout(r, 0));
  });
});
