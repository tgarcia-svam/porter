import { describe, it, expect } from "vitest";

// 32-byte key (base64) — required before the module's lazy getKey() runs.
process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { encryptSecret, decryptSecret } from "../crypto-at-rest";

describe("crypto-at-rest", () => {
  it("round-trips a secret", () => {
    const plaintext = "JBSWY3DPEHPK3PXP";
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("throws on a tampered ciphertext", () => {
    const enc = encryptSecret("tamper-me");
    const parts = enc.split(":");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("throws on a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow();
  });

  it("throws on an unknown version tag", () => {
    const enc = encryptSecret("x");
    const parts = enc.split(":");
    parts[0] = "v2";
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});
