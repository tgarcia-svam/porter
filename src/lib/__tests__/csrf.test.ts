import { describe, it, expect } from "vitest";
import { type NextRequest } from "next/server";
import {
  generateCsrfToken,
  validateCsrf,
  CSRF_COOKIE,
  CSRF_HEADER,
} from "../csrf";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(cookieValue?: string, headerValue?: string) {
  return {
    cookies: {
      get: (name: string) =>
        name === CSRF_COOKIE && cookieValue !== undefined
          ? { value: cookieValue }
          : undefined,
    },
    headers: {
      get: (name: string) =>
        name === CSRF_HEADER ? (headerValue ?? null) : null,
    },
  } as unknown as NextRequest;
}

const VALID_TOKEN = "a".repeat(64);

// ── generateCsrfToken ─────────────────────────────────────────────────────────

describe("generateCsrfToken", () => {
  it("returns a 64-character string", () => {
    expect(generateCsrfToken()).toHaveLength(64);
  });

  it("returns only lowercase hex characters", () => {
    expect(generateCsrfToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a different token on each call", () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).not.toBe(b);
  });
});

// ── validateCsrf ──────────────────────────────────────────────────────────────

describe("validateCsrf", () => {
  it("returns true when cookie and header match and are 64 chars", () => {
    expect(validateCsrf(makeReq(VALID_TOKEN, VALID_TOKEN))).toBe(true);
  });

  it("returns false when cookie is missing", () => {
    expect(validateCsrf(makeReq(undefined, VALID_TOKEN))).toBe(false);
  });

  it("returns false when header is missing", () => {
    expect(validateCsrf(makeReq(VALID_TOKEN, undefined))).toBe(false);
  });

  it("returns false when both are missing", () => {
    expect(validateCsrf(makeReq())).toBe(false);
  });

  it("returns false when cookie and header do not match", () => {
    expect(validateCsrf(makeReq(VALID_TOKEN, "b".repeat(64)))).toBe(false);
  });

  it("returns false when token is shorter than 64 chars", () => {
    const short = "a".repeat(63);
    expect(validateCsrf(makeReq(short, short))).toBe(false);
  });

  it("returns false when token is longer than 64 chars", () => {
    const long = "a".repeat(65);
    expect(validateCsrf(makeReq(long, long))).toBe(false);
  });

  it("returns false for empty string tokens", () => {
    expect(validateCsrf(makeReq("", ""))).toBe(false);
  });

  it("accepts a real generated token", () => {
    const token = generateCsrfToken();
    expect(validateCsrf(makeReq(token, token))).toBe(true);
  });
});
