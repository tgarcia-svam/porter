import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

process.env.NEXTAUTH_SECRET = "test-nextauth-secret-value";

import {
  issueLoginTicket,
  verifyLoginTicket,
  issuePendingTicket,
  verifyPendingTicket,
} from "../login-ticket";

describe("login tickets — round trip", () => {
  it("verifies a login ticket back to the (lowercased) email", () => {
    const t = issueLoginTicket("User@Example.com");
    expect(verifyLoginTicket(t)).toBe("user@example.com");
  });
  it("verifies a pending ticket back to the email", () => {
    const t = issuePendingTicket("a@b.com");
    expect(verifyPendingTicket(t)).toBe("a@b.com");
  });
});

describe("login tickets — kind isolation", () => {
  it("does not accept a pending ticket as a login ticket", () => {
    expect(verifyLoginTicket(issuePendingTicket("a@b.com"))).toBeNull();
  });
  it("does not accept a login ticket as a pending ticket", () => {
    expect(verifyPendingTicket(issueLoginTicket("a@b.com"))).toBeNull();
  });
});

describe("login tickets — integrity", () => {
  it("rejects a tampered ticket", () => {
    const t = issueLoginTicket("a@b.com");
    const tampered = t.slice(0, -1) + (t.endsWith("a") ? "b" : "a");
    expect(verifyLoginTicket(tampered)).toBeNull();
  });
  it("rejects malformed input", () => {
    expect(verifyLoginTicket("garbage")).toBeNull();
    expect(verifyLoginTicket("")).toBeNull();
  });
});

describe("login tickets — expiry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rejects a login ticket after 60s", () => {
    const t = issueLoginTicket("a@b.com");
    vi.advanceTimersByTime(61_000);
    expect(verifyLoginTicket(t)).toBeNull();
  });
  it("accepts a pending ticket within 5 minutes but not after", () => {
    const t = issuePendingTicket("a@b.com");
    vi.advanceTimersByTime(4 * 60_000);
    expect(verifyPendingTicket(t)).toBe("a@b.com");
    vi.advanceTimersByTime(2 * 60_000);
    expect(verifyPendingTicket(t)).toBeNull();
  });
});
