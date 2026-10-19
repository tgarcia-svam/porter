import { describe, it, expect } from "vitest";
import { maskEmail } from "../mask-email";

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("vledesma@oti.nyc.gov")).toBe("v•••@oti.nyc.gov");
  });
  it("never contains an email-shaped string", () => {
    expect(maskEmail("a@b.co")).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]+/);
  });
  it("handles empty and malformed input", () => {
    expect(maskEmail("")).toBe("");
    expect(maskEmail(null)).toBe("");
    expect(maskEmail("noatsign")).toBe("n•••");
  });
});
