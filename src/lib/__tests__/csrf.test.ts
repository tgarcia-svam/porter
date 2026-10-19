import { describe, it, expect } from "vitest";
import { type NextRequest } from "next/server";
import {
  generateCsrfToken,
  computeCsrfToken,
  validateCsrf,
  CSRF_COOKIE,
  CSRF_HEADER,
} from "../csrf";

process.env.NEXTAUTH_SECRET = "unit-test-secret-unit-test-secret";

function makeReq(nonce?: string, header?: string) {
  return {
    cookies: {
      get: (name: string) =>
        name === CSRF_COOKIE && nonce !== undefined ? { value: nonce } : undefined,
    },
    headers: { get: (name: string) => (name === CSRF_HEADER ? (header ?? null) : null) },
  } as unknown as NextRequest;
}

const NONCE = "a".repeat(64);

describe("generateCsrfToken", () => {
  it("returns 64 lowercase hex chars", () => {
    expect(generateCsrfToken()).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is unique per call", () => {
    expect(generateCsrfToken()).not.toBe(generateCsrfToken());
  });
});

describe("computeCsrfToken", () => {
  it("is deterministic 64-hex", async () => {
    const a = await computeCsrfToken(NONCE, "anon");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await computeCsrfToken(NONCE, "anon")).toBe(a);
  });
  it("differs per session binding and per nonce", async () => {
    const anon = await computeCsrfToken(NONCE, "anon");
    expect(await computeCsrfToken(NONCE, "session-1")).not.toBe(anon);
    expect(await computeCsrfToken("b".repeat(64), "anon")).not.toBe(anon);
  });
  it("differs per signing secret", async () => {
    expect(await computeCsrfToken(NONCE, "x", "k1")).not.toBe(await computeCsrfToken(NONCE, "x", "k2"));
  });
  it("returns null without a secret or nonce", async () => {
    expect(await computeCsrfToken(NONCE, "x", "")).toBeNull();
    expect(await computeCsrfToken("", "x", "k")).toBeNull();
  });
});

describe("validateCsrf", () => {
  it("accepts the token derived from the cookie nonce and session binding", async () => {
    const t = await computeCsrfToken(NONCE, "session-1");
    expect(await validateCsrf(makeReq(NONCE, t!), "session-1")).toBe(true);
  });
  it("accepts an anonymous token for anon binding", async () => {
    const t = await computeCsrfToken(NONCE, "anon");
    expect(await validateCsrf(makeReq(NONCE, t!), "anon")).toBe(true);
  });
  it("rejects a token issued for a different session", async () => {
    const t = await computeCsrfToken(NONCE, "session-1");
    expect(await validateCsrf(makeReq(NONCE, t!), "session-2")).toBe(false);
  });
  it("rejects an anonymous token once signed in", async () => {
    const t = await computeCsrfToken(NONCE, "anon");
    expect(await validateCsrf(makeReq(NONCE, t!), "session-1")).toBe(false);
  });
  it("rejects the raw cookie value echoed as the header", async () => {
    expect(await validateCsrf(makeReq(NONCE, NONCE), "anon")).toBe(false);
  });
  it("rejects a tampered token", async () => {
    const t = (await computeCsrfToken(NONCE, "anon"))!;
    const bad = (t[0] === "0" ? "1" : "0") + t.slice(1);
    expect(await validateCsrf(makeReq(NONCE, bad), "anon")).toBe(false);
  });
  it("rejects missing cookie, missing header, or wrong lengths", async () => {
    const t = (await computeCsrfToken(NONCE, "anon"))!;
    expect(await validateCsrf(makeReq(undefined, t), "anon")).toBe(false);
    expect(await validateCsrf(makeReq(NONCE, undefined), "anon")).toBe(false);
    expect(await validateCsrf(makeReq("short", t), "anon")).toBe(false);
    expect(await validateCsrf(makeReq(NONCE, "short"), "anon")).toBe(false);
  });
  it("fails closed when no signing secret is configured", async () => {
    const saved = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
    const t = "c".repeat(64);
    expect(await validateCsrf(makeReq(NONCE, t), "anon")).toBe(false);
    process.env.NEXTAUTH_SECRET = saved;
  });
});
