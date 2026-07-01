import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

process.env.NEXTAUTH_SECRET = "test-nextauth-secret-value";

import { signChallenge, readChallenge } from "../webauthn";

const EMAIL = "user@example.com";
const CHALLENGE = "abc123_challenge-value";

describe("webauthn challenge cookie", () => {
  it("round-trips a challenge for the matching scope + email", () => {
    const cookie = signChallenge("auth", EMAIL, CHALLENGE);
    expect(readChallenge(cookie, "auth", EMAIL)).toBe(CHALLENGE);
  });

  it("rejects a scope mismatch", () => {
    const cookie = signChallenge("reg", EMAIL, CHALLENGE);
    expect(readChallenge(cookie, "auth", EMAIL)).toBeNull();
  });

  it("rejects an email mismatch", () => {
    const cookie = signChallenge("auth", EMAIL, CHALLENGE);
    expect(readChallenge(cookie, "auth", "other@example.com")).toBeNull();
  });

  it("is case-insensitive on email", () => {
    const cookie = signChallenge("auth", "User@Example.com", CHALLENGE);
    expect(readChallenge(cookie, "auth", "user@example.com")).toBe(CHALLENGE);
  });

  it("rejects a tampered or malformed cookie", () => {
    const cookie = signChallenge("auth", EMAIL, CHALLENGE);
    expect(readChallenge(cookie + "x", "auth", EMAIL)).toBeNull();
    expect(readChallenge("a.b.c", "auth", EMAIL)).toBeNull();
    expect(readChallenge(undefined, "auth", EMAIL)).toBeNull();
  });

  it("rejects an expired challenge", () => {
    vi.useFakeTimers();
    try {
      const cookie = signChallenge("auth", EMAIL, CHALLENGE);
      vi.advanceTimersByTime(6 * 60_000); // TTL is 5 minutes
      expect(readChallenge(cookie, "auth", EMAIL)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
