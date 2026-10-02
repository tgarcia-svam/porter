import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../prisma-admin", () => ({
  prismaAdmin: { user: { update: vi.fn().mockResolvedValue({}) } },
}));
vi.mock("../auth-audit", () => ({ logAuthEvent: vi.fn() }));

import {
  hashPassword,
  verifyPassword,
  getLockState,
  recordFailedAttempt,
  recordSuccess,
  clearLockoutForReset,
  TEMP_LOCK_THRESHOLD,
  HARD_LOCK_THRESHOLD,
} from "../password-auth";
import { prismaAdmin } from "../prisma-admin";

const mockUpdate = vi.mocked(prismaAdmin.user.update);

function user(overrides: Partial<{ failedLoginAttempts: number; lastFailedLoginAt: Date | null }> = {}) {
  return {
    id: "u1",
    email: "u@test.com",
    failedLoginAttempts: 0,
    lastFailedLoginAt: null as Date | null,
    ...overrides,
  };
}

const recent = () => new Date(Date.now() - 1_000);
const longAgo = () => new Date(Date.now() - 16 * 60_000);

beforeEach(() => vi.clearAllMocks());

// ── hashing ──────────────────────────────────────────────────────────────────
describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
  it("returns false on a malformed hash instead of throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

// ── getLockState (pure) ────────────────────────────────────────────────────────
describe("getLockState", () => {
  it("reports a hard lock", () => {
    expect(getLockState({ lockedForReset: true, lockedUntil: null })).toEqual({
      locked: true,
      reason: "locked_reset",
    });
  });
  it("reports a temporary lock with a positive retry window", () => {
    const s = getLockState({ lockedForReset: false, lockedUntil: new Date(Date.now() + 60_000) });
    expect(s.locked).toBe(true);
    if (s.locked && s.reason === "locked_temp") expect(s.retryAfterSec).toBeGreaterThan(0);
    else throw new Error("expected locked_temp");
  });
  it("is not locked when the temp lock has expired", () => {
    expect(getLockState({ lockedForReset: false, lockedUntil: new Date(Date.now() - 1) })).toEqual({
      locked: false,
    });
  });
  it("is not locked with no lock state", () => {
    expect(getLockState({ lockedForReset: false, lockedUntil: null })).toEqual({ locked: false });
  });
});

// ── recordFailedAttempt (two-tier escalation) ──────────────────────────────────
describe("recordFailedAttempt", () => {
  it("increments without locking on the first failure", async () => {
    const state = await recordFailedAttempt(user());
    expect(state).toEqual({ locked: false });
    const { data } = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.failedLoginAttempts).toBe(1);
    expect(data.lockedUntil).toBeUndefined();
    expect(data.lockedForReset).toBeUndefined();
  });

  it(`applies a temporary lock at ${TEMP_LOCK_THRESHOLD} in-window failures`, async () => {
    const state = await recordFailedAttempt(
      user({ failedLoginAttempts: TEMP_LOCK_THRESHOLD - 1, lastFailedLoginAt: recent() })
    );
    expect(state.locked && state.reason).toBe("locked_temp");
    const { data } = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.failedLoginAttempts).toBe(TEMP_LOCK_THRESHOLD);
    expect(data.lockedUntil).toBeInstanceOf(Date);
  });

  it(`applies a hard lock at ${HARD_LOCK_THRESHOLD} in-window failures`, async () => {
    const state = await recordFailedAttempt(
      user({ failedLoginAttempts: HARD_LOCK_THRESHOLD - 1, lastFailedLoginAt: recent() })
    );
    expect(state.locked && state.reason).toBe("locked_reset");
    const { data } = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.lockedForReset).toBe(true);
  });

  it("resets the counter when the 15-minute window has elapsed", async () => {
    const state = await recordFailedAttempt(
      user({ failedLoginAttempts: TEMP_LOCK_THRESHOLD - 1, lastFailedLoginAt: longAgo() })
    );
    expect(state).toEqual({ locked: false });
    const { data } = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.failedLoginAttempts).toBe(1);
  });
});

// ── recordSuccess / clearLockoutForReset ───────────────────────────────────────
const baseSuccessUser = {
  id: "u1",
  email: "u@test.com",
  failedLoginAttempts: 3,
  lockedUntil: null,
  lastLoginAt: null,
  lastLoginIp: null,
};

describe("recordSuccess", () => {
  it("clears counters and stamps lastLoginAt", async () => {
    await recordSuccess(baseSuccessUser);
    const { data } = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({ failedLoginAttempts: 0, lockedUntil: null });
    expect(data.lastLoginAt).toBeInstanceOf(Date);
  });
  it("always writes (to stamp lastLoginAt) even with no prior failure state", async () => {
    await recordSuccess({ ...baseSuccessUser, failedLoginAttempts: 0 });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("clearLockoutForReset", () => {
  it("releases the hard lock and all counters", async () => {
    await clearLockoutForReset("u1");
    const { data } = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
      lockedUntil: null,
      lockedForReset: false,
    });
  });
});
