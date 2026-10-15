import { describe, it, expect } from "vitest";
import { comparisonError, checkValue } from "../validate-core";

const rule = {
  sourceColumnName: "Interview Date",
  operator: "GTE" as const,
  targetColumnName: "DOB",
};

describe("comparisonError", () => {
  it("passes when the ordering is satisfied", () => {
    expect(comparisonError(rule, "2024-05-01", "1990-01-01", "DATE")).toBeNull();
    expect(comparisonError(rule, "1990-01-01", "1990-01-01", "DATE")).toBeNull();
  });

  it("names both columns in plain English for dates", () => {
    expect(comparisonError(rule, "1980-01-01", "1990-01-01", "DATE")).toBe(
      "Interview Date must be on or after DOB"
    );
  });

  it("uses numeric phrasing for numbers", () => {
    const r = { sourceColumnName: "Min", operator: "LT" as const, targetColumnName: "Max" };
    expect(comparisonError(r, "5", "3", "NUMBER")).toBe("Min must be less than Max");
    expect(comparisonError(r, "3", "5", "NUMBER")).toBeNull();
  });

  it("skips blank or unparseable values (reported by per-cell checks)", () => {
    expect(comparisonError(rule, "", "1990-01-01", "DATE")).toBeNull();
    expect(comparisonError(rule, "not a date", "1990-01-01", "DATE")).toBeNull();
  });
});

describe("checkValue", () => {
  it("flags bad types", () => {
    expect(checkValue("abc", "INTEGER")).not.toBeNull();
    expect(checkValue("2024-02-30", "DATE")).not.toBeNull();
    expect(checkValue("maybe", "BOOLEAN")).not.toBeNull();
    expect(checkValue("a@b.co", "EMAIL")).toBeNull();
  });
});
