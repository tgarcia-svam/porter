import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeVisualizations,
  type VisualizationConfig,
} from "../visualization-aggregate";

// A mock raw client: computeVisualizations only calls `$queryRaw` as a tagged
// template — `$queryRaw(strings, ...values)`. We assert on the interpolated
// values (which include the uploadIds array) and control the returned rows.
function makeClient(rows: unknown[]) {
  return { $queryRaw: vi.fn().mockResolvedValue(rows) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (c: { $queryRaw: any }) => c as any;

function viz(partial: Partial<VisualizationConfig> & { id: string; type: VisualizationConfig["type"] }): VisualizationConfig {
  return {
    title: "T",
    aggregate: "COUNT",
    valueColumn: "amount",
    xColumn: null,
    granularity: null,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeVisualizations — short-circuits", () => {
  it("returns [] and runs no query when there are no uploads", async () => {
    const client = makeClient([]);
    const out = await computeVisualizations(asClient(client), [], [viz({ id: "v1", type: "INDICATOR" })]);
    expect(out).toEqual([]);
    expect(client.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns [] and runs no query when there are no visualizations", async () => {
    const client = makeClient([]);
    const out = await computeVisualizations(asClient(client), ["u1"], []);
    expect(out).toEqual([]);
    expect(client.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("computeVisualizations — INDICATOR", () => {
  it("coerces the aggregate value to a number", async () => {
    const client = makeClient([{ value: "42" }]);
    const out = await computeVisualizations(
      asClient(client),
      ["u1"],
      [viz({ id: "v1", type: "INDICATOR", aggregate: "SUM", title: "Total" })]
    );
    expect(out).toEqual([
      { id: "v1", type: "INDICATOR", title: "Total", aggregate: "SUM", value: 42 },
    ]);
  });

  it("returns null when the aggregate is empty/non-numeric", async () => {
    const client = makeClient([{ value: null }]);
    const out = await computeVisualizations(
      asClient(client),
      ["u1"],
      [viz({ id: "v1", type: "INDICATOR", aggregate: "AVG" })]
    );
    expect(out[0].value).toBeNull();
  });

  it("passes all uploadIds through to the query (pooling)", async () => {
    const client = makeClient([{ value: "1" }]);
    await computeVisualizations(
      asClient(client),
      ["u1", "u2", "u3"],
      [viz({ id: "v1", type: "INDICATOR" })]
    );
    // The uploadIds array is one of the interpolated template values.
    expect(client.$queryRaw.mock.calls[0]).toContainEqual(["u1", "u2", "u3"]);
  });
});

describe("computeVisualizations — BAR / LINE", () => {
  it("maps grouped rows to points, defaulting non-numeric values to 0", async () => {
    const client = makeClient([
      { label: "a", value: "3" },
      { label: "b", value: "x" }, // non-numeric → 0
    ]);
    const out = await computeVisualizations(
      asClient(client),
      ["u1"],
      [viz({ id: "v1", type: "BAR", aggregate: "SUM", xColumn: "day", title: "By day" })]
    );
    expect(out).toEqual([
      {
        id: "v1",
        type: "BAR",
        title: "By day",
        aggregate: "SUM",
        points: [
          { label: "a", value: 3 },
          { label: "b", value: 0 },
        ],
      },
    ]);
  });
});
