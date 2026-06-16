import { describe, it, expect } from "vitest";
import { validateVisualizations, type VisualizationInput } from "../visualization-input";

const columns = [
  { name: "region", dataType: "TEXT" },
  { name: "amount", dataType: "NUMBER" },
  { name: "qty", dataType: "INTEGER" },
  { name: "sale_date", dataType: "DATE" },
];

function viz(overrides: Partial<VisualizationInput> = {}): VisualizationInput {
  return {
    type: "INDICATOR",
    title: "Total",
    aggregate: "COUNT",
    valueColumn: "region",
    xColumn: null,
    granularity: null,
    order: 0,
    ...overrides,
  };
}

describe("validateVisualizations", () => {
  it("accepts a count indicator (counts all records)", () => {
    expect(validateVisualizations(columns, [viz({ valueColumn: "*" })])).toBeNull();
  });

  it("accepts a count even with an unknown value column (it's ignored)", () => {
    expect(validateVisualizations(columns, [viz({ aggregate: "COUNT", valueColumn: "whatever" })])).toBeNull();
  });

  it("accepts a sum indicator on a numeric column", () => {
    expect(
      validateVisualizations(columns, [viz({ aggregate: "SUM", valueColumn: "amount" })])
    ).toBeNull();
  });

  it("accepts a valid bar chart", () => {
    expect(
      validateVisualizations(columns, [
        viz({ type: "BAR", aggregate: "AVG", valueColumn: "amount", xColumn: "region" }),
      ])
    ).toBeNull();
  });

  it("rejects an unknown value column for a non-count aggregate", () => {
    const err = validateVisualizations(columns, [viz({ aggregate: "SUM", valueColumn: "nope" })]);
    expect(err).toContain("unknown column");
  });

  it("rejects a numeric aggregate on a non-numeric column", () => {
    const err = validateVisualizations(columns, [
      viz({ aggregate: "AVG", valueColumn: "region" }),
    ]);
    expect(err).toContain("non-numeric");
  });

  it("rejects a bar/line chart without an x-axis column", () => {
    const err = validateVisualizations(columns, [
      viz({ type: "LINE", aggregate: "SUM", valueColumn: "amount", xColumn: null }),
    ]);
    expect(err).toContain("x-axis");
  });

  it("rejects a bar/line chart with an unknown x-axis column", () => {
    const err = validateVisualizations(columns, [
      viz({ type: "BAR", aggregate: "SUM", valueColumn: "amount", xColumn: "ghost" }),
    ]);
    expect(err).toContain("unknown x-axis column");
  });

  it("accepts a date x-axis chart with a granularity", () => {
    expect(
      validateVisualizations(columns, [
        viz({ type: "LINE", aggregate: "SUM", valueColumn: "amount", xColumn: "sale_date", granularity: "MONTH" }),
      ])
    ).toBeNull();
  });

  it("rejects granularity on a non-date x-axis column", () => {
    const err = validateVisualizations(columns, [
      viz({ type: "BAR", aggregate: "SUM", valueColumn: "amount", xColumn: "region", granularity: "MONTH" }),
    ]);
    expect(err).toContain("date");
  });

  it("rejects granularity on an indicator", () => {
    const err = validateVisualizations(columns, [
      viz({ type: "INDICATOR", aggregate: "COUNT", valueColumn: "region", granularity: "MONTH" }),
    ]);
    expect(err).toContain("bar or line");
  });

  it("returns the first error across multiple visualizations", () => {
    const err = validateVisualizations(columns, [
      viz({ aggregate: "SUM", valueColumn: "amount" }),
      viz({ aggregate: "AVG", valueColumn: "missing" }),
    ]);
    expect(err).toContain("missing");
  });
});
