import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../auth", () => ({ auth: vi.fn() }));
vi.mock("../auth-audit", () => ({ logAuthEvent: vi.fn() }));
vi.mock("../session-binding", () => ({
  verifySessionBinding: vi.fn().mockReturnValue(true),
}));
vi.mock("../audit-context", () => ({
  auditStore: { enterWith: vi.fn() },
  clientIp: vi.fn().mockReturnValue("1.2.3.4"),
}));

import { requireAdmin } from "../api-auth";
import { auth } from "../auth";
import { logAuthEvent } from "../auth-audit";
import { verifySessionBinding } from "../session-binding";
import { auditStore } from "../audit-context";

const mockAuth = vi.mocked(auth);
const mockLogAuthEvent = vi.mocked(logAuthEvent);
const mockVerifyBinding = vi.mocked(verifySessionBinding);
const mockAuditStore = vi.mocked(auditStore);

function makeReq(ua = "TestBrowser/1.0") {
  return {
    headers: { get: (n: string) => (n === "user-agent" ? ua : null) },
  } as unknown as import("next/server").NextRequest;
}

function adminSession() {
  return { user: { id: "uid1", email: "admin@test.com", role: "ADMIN", uaHash: "abc" } };
}

function uploaderSession() {
  return { user: { id: "uid2", email: "uploader@test.com", role: "UPLOADER", uaHash: "abc" } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyBinding.mockReturnValue(true);
});

// ── No session ────────────────────────────────────────────────────────────────

describe("requireAdmin — unauthenticated", () => {
  it("returns null when auth() returns null", async () => {
    mockAuth.mockResolvedValue(null as never);
    expect(await requireAdmin(makeReq())).toBeNull();
  });

  it("logs auth.access.forbidden when session is missing", async () => {
    mockAuth.mockResolvedValue(null as never);
    await requireAdmin(makeReq());
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.access.forbidden" })
    );
  });

  it("returns null when session has no user", async () => {
    mockAuth.mockResolvedValue({ user: undefined } as never);
    expect(await requireAdmin(makeReq())).toBeNull();
  });
});

// ── Session binding failure ───────────────────────────────────────────────────

describe("requireAdmin — session binding mismatch", () => {
  it("returns null when verifySessionBinding returns false", async () => {
    mockAuth.mockResolvedValue(adminSession() as never);
    mockVerifyBinding.mockReturnValue(false);
    expect(await requireAdmin(makeReq())).toBeNull();
  });

  it("logs auth.session.invalid on binding failure", async () => {
    mockAuth.mockResolvedValue(adminSession() as never);
    mockVerifyBinding.mockReturnValue(false);
    await requireAdmin(makeReq());
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.session.invalid", userId: "uid1" })
    );
  });
});

// ── Non-admin role ────────────────────────────────────────────────────────────

describe("requireAdmin — wrong role", () => {
  it("returns null for UPLOADER role", async () => {
    mockAuth.mockResolvedValue(uploaderSession() as never);
    expect(await requireAdmin(makeReq())).toBeNull();
  });

  it("logs auth.access.forbidden for non-admin", async () => {
    mockAuth.mockResolvedValue(uploaderSession() as never);
    await requireAdmin(makeReq());
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.access.forbidden", userId: "uid2" })
    );
  });
});

// ── Successful admin ──────────────────────────────────────────────────────────

describe("requireAdmin — valid admin", () => {
  it("returns the session for a valid admin", async () => {
    const session = adminSession();
    mockAuth.mockResolvedValue(session as never);
    const result = await requireAdmin(makeReq());
    expect(result).toEqual(session);
  });

  it("calls auditStore.enterWith with user id and email", async () => {
    mockAuth.mockResolvedValue(adminSession() as never);
    await requireAdmin(makeReq());
    expect(mockAuditStore.enterWith).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "uid1", userEmail: "admin@test.com" })
    );
  });

  it("does not log a forbidden event for valid admin", async () => {
    mockAuth.mockResolvedValue(adminSession() as never);
    await requireAdmin(makeReq());
    expect(mockLogAuthEvent).not.toHaveBeenCalled();
  });

  it("works when called without a request argument", async () => {
    mockAuth.mockResolvedValue(adminSession() as never);
    const result = await requireAdmin();
    expect(result).toBeDefined();
  });

  it("sets userEmail to undefined in auditStore when email is null", async () => {
    const session = { user: { id: "uid3", email: null, role: "ADMIN", uaHash: null } };
    mockAuth.mockResolvedValue(session as never);
    await requireAdmin(makeReq());
    expect(mockAuditStore.enterWith).toHaveBeenCalledWith(
      expect.objectContaining({ userEmail: undefined })
    );
  });
});
