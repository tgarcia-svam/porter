import { describe, it, expect } from "vitest";
import {
  validatePassword,
  checkPassword,
  MIN_PASSWORD_LENGTH,
  MIN_CHARACTER_CLASSES,
} from "../password-policy";

// A password that satisfies every rule: 18 chars, 4 classes, not common.
const STRONG = "Tr0ubad0ur&Xk9qLmz";

describe("checkPassword — length", () => {
  it("fails below the minimum", () => {
    expect(checkPassword("Ab1$xyz").length).toBe(false);
  });
  it("passes at exactly the minimum", () => {
    const pw = "Aa1$" + "x".repeat(MIN_PASSWORD_LENGTH - 4);
    expect(pw.length).toBe(MIN_PASSWORD_LENGTH);
    expect(checkPassword(pw).length).toBe(true);
  });
});

describe("checkPassword — character classes", () => {
  it("counts all four classes", () => {
    expect(checkPassword(STRONG).classCount).toBe(4);
  });
  it("passes with exactly three classes", () => {
    // upper + lower + special, no digit
    const c = checkPassword("Troubadour&Xkqlmz");
    expect(c.classCount).toBe(MIN_CHARACTER_CLASSES);
    expect(c.classes).toBe(true);
  });
  it("fails with only two classes", () => {
    const c = checkPassword("troubadour&xkqlmz"); // lower + special
    expect(c.classCount).toBe(2);
    expect(c.classes).toBe(false);
  });
});

describe("checkPassword — common / banned", () => {
  it("rejects a single repeated character", () => {
    expect(checkPassword("aaaaaaaaaaaaaaaa").notCommon).toBe(false);
  });
  it("rejects a password containing a banned base", () => {
    // 15 chars, 4 classes, but contains "password"
    expect(checkPassword("Password123!456").notCommon).toBe(false);
  });
  it("rejects a long sequential digit run", () => {
    expect(checkPassword("1234567890123456").notCommon).toBe(false);
  });
  it("accepts a unique strong password", () => {
    expect(checkPassword(STRONG).notCommon).toBe(true);
  });
});

describe("checkPassword — username containment", () => {
  it("rejects a password containing the email local-part", () => {
    expect(checkPassword("Xk9!john!qwertzmb", "john@example.com").notUsername).toBe(false);
  });
  it("allows when the local-part is absent", () => {
    expect(checkPassword(STRONG, "john@example.com").notUsername).toBe(true);
  });
  it("ignores very short local-parts", () => {
    // local-part "jo" is < 3 chars → not enforced
    expect(checkPassword(STRONG, "jo@example.com").notUsername).toBe(true);
  });
});

describe("validatePassword", () => {
  it("passes a strong password with no errors", () => {
    const r = validatePassword(STRONG);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });
  it("reports a length error", () => {
    const r = validatePassword("Ab1$xyz");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /15 characters/.test(e))).toBe(true);
  });
  it("reports a class error", () => {
    const r = validatePassword("abcdefghijklmnopq"); // lowercase only
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /3 of/.test(e))).toBe(true);
  });
  it("reports a common-password error", () => {
    const r = validatePassword("Password123!456");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /common/i.test(e))).toBe(true);
  });
  it("reports a username error", () => {
    const r = validatePassword("Xk9!john!qwertzmb", "john@example.com");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /username/i.test(e))).toBe(true);
  });
});
