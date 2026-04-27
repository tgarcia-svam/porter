import { describe, it, expect } from "vitest";
import { hashUa, verifySessionBinding } from "../session-binding";

// ── hashUa ────────────────────────────────────────────────────────────────────

describe("hashUa", () => {
  it("returns null for null input", () => {
    expect(hashUa(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(hashUa(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(hashUa("")).toBeNull();
  });

  it("returns a 64-character hex string for a real UA", () => {
    const result = hashUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hash for the same input", () => {
    const ua = "TestBrowser/1.0";
    expect(hashUa(ua)).toBe(hashUa(ua));
  });

  it("returns different hashes for different inputs", () => {
    expect(hashUa("BrowserA/1.0")).not.toBe(hashUa("BrowserB/2.0"));
  });
});

// ── verifySessionBinding ──────────────────────────────────────────────────────

function makeReq(ua?: string): Pick<Request, "headers"> {
  return {
    headers: { get: (name: string) => (name === "user-agent" ? (ua ?? null) : null) } as Headers,
  };
}

describe("verifySessionBinding", () => {
  it("returns true when boundUaHash is null (unbound session)", () => {
    expect(verifySessionBinding(null, makeReq("any-browser"))).toBe(true);
  });

  it("returns true when boundUaHash is undefined (unbound session)", () => {
    expect(verifySessionBinding(undefined, makeReq("any-browser"))).toBe(true);
  });

  it("returns true when UA matches the bound hash", () => {
    const ua = "Mozilla/5.0 TestBrowser";
    const bound = hashUa(ua)!;
    expect(verifySessionBinding(bound, makeReq(ua))).toBe(true);
  });

  it("returns false when current UA differs from bound hash", () => {
    const bound = hashUa("original-browser/1.0")!;
    expect(verifySessionBinding(bound, makeReq("different-browser/2.0"))).toBe(false);
  });

  it("returns false when current request has no UA but session is bound", () => {
    const bound = hashUa("some-browser")!;
    expect(verifySessionBinding(bound, makeReq(undefined))).toBe(false);
  });
});
