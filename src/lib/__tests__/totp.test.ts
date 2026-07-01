import { describe, it, expect } from "vitest";
import { generate } from "otplib";
import { generateTotpSecret, buildOtpAuthUrl, verifyTotp } from "../totp";

describe("totp", () => {
  it("verifies a freshly generated code", async () => {
    const secret = generateTotpSecret();
    const token = await generate({ secret });
    expect(await verifyTotp(token, secret)).toBe(true);
  });

  it("rejects malformed / wrong-length codes", async () => {
    const secret = generateTotpSecret();
    expect(await verifyTotp("123", secret)).toBe(false);
    expect(await verifyTotp("abcdef", secret)).toBe(false);
    expect(await verifyTotp("", secret)).toBe(false);
  });

  it("rejects a valid code from a different secret", async () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const tokenB = await generate({ secret: secretB });
    expect(await verifyTotp(tokenB, secretA)).toBe(false);
  });

  it("builds an otpauth URL bound to the issuer and account", () => {
    const url = buildOtpAuthUrl("user@example.com", generateTotpSecret());
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain("Porter");
    expect(decodeURIComponent(url)).toContain("user@example.com");
  });
});
