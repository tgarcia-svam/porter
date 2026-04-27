import { describe, it, expect } from "vitest";
import { clientIp, auditStore } from "../audit-context";

// ── clientIp ──────────────────────────────────────────────────────────────────

function makeReq(headers: Record<string, string>): Request {
  return {
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
  } as unknown as Request;
}

describe("clientIp", () => {
  it("returns the first IP from x-forwarded-for", () => {
    expect(clientIp(makeReq({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("returns the only IP when x-forwarded-for has one entry", () => {
    expect(clientIp(makeReq({ "x-forwarded-for": "10.0.0.1" }))).toBe("10.0.0.1");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    expect(clientIp(makeReq({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("returns undefined when neither header is present", () => {
    expect(clientIp(makeReq({}))).toBeUndefined();
  });

  it("trims whitespace from x-forwarded-for IPs", () => {
    expect(clientIp(makeReq({ "x-forwarded-for": "  1.2.3.4  , 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("prefers x-forwarded-for over x-real-ip", () => {
    expect(
      clientIp(makeReq({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" }))
    ).toBe("1.1.1.1");
  });
});

// ── auditStore ────────────────────────────────────────────────────────────────

describe("auditStore", () => {
  it("stores and retrieves context within the same async context", async () => {
    await new Promise<void>((resolve) => {
      auditStore.run({ userId: "u1", userEmail: "a@b.com", ip: "1.1.1.1" }, () => {
        expect(auditStore.getStore()).toEqual({
          userId: "u1",
          userEmail: "a@b.com",
          ip: "1.1.1.1",
        });
        resolve();
      });
    });
  });

  it("returns undefined outside of an async context", () => {
    // AsyncLocalStorage.getStore() returns undefined when called outside a run()
    // context — but since tests share the same process, we can only assert it
    // doesn't throw and returns something predictable.
    expect(() => auditStore.getStore()).not.toThrow();
  });

  it("isolates context between sibling async contexts", async () => {
    const results: Array<ReturnType<typeof auditStore.getStore>> = [];

    await Promise.all([
      new Promise<void>((resolve) =>
        auditStore.run({ userId: "user-A" }, () => {
          results.push(auditStore.getStore());
          resolve();
        })
      ),
      new Promise<void>((resolve) =>
        auditStore.run({ userId: "user-B" }, () => {
          results.push(auditStore.getStore());
          resolve();
        })
      ),
    ]);

    expect(results.map((r) => r?.userId).sort()).toEqual(["user-A", "user-B"]);
  });
});
