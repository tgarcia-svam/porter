import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const track = { trackTrace: vi.fn(), trackException: vi.fn() };
let defaultClient: typeof track | undefined;

vi.mock("applicationinsights", () => ({
  get defaultClient() {
    return defaultClient;
  },
  KnownSeverityLevel: { Information: 1, Warning: 2, Error: 3 },
}));

import { logger } from "../logger";

describe("logger local fallback", () => {
  const spies = {
    out: vi.spyOn(process.stdout, "write").mockImplementation(() => true),
    err: vi.spyOn(process.stderr, "write").mockImplementation(() => true),
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
  const text = (spy: typeof spies.warn) => String(spy.mock.calls[0][0]);
  beforeEach(() => {
    defaultClient = undefined;
    Object.values(spies).forEach((s) => s.mockClear());
  });
  afterEach(() => vi.clearAllMocks());

  it("writes a single clean line for CRLF/ANSI injection", () => {
    logger.error("login failed\r\n[auth] forged \u001b[31mred", new Error("bad\nline"));
    const line = text(spies.error);
    expect(spies.error.mock.calls).toHaveLength(1);
    expect(line).toMatch(/^[A-Za-z0-9 _.:\-[\]|]+$/);
    expect(line).not.toMatch(/[\r\n\u001b]/);
  });

  it("caps length and never prints stack text", () => {
    logger.error("m", new Error("x".repeat(1000)));
    const line = text(spies.error);
    expect(line).not.toContain("at ");
    expect(line.length).toBeLessThan(500);
  });

  it("uses only console.warn/error with a level prefix", () => {
    logger.info("hello\nworld");
    logger.warn("careful");
    expect(spies.warn.mock.calls.map((c) => c[0])).toEqual([
      "[info] hello_world",
      "[warn] careful",
    ]);
    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.out).not.toHaveBeenCalled();
    expect(spies.err).not.toHaveBeenCalled();
  });
});

describe("logger with App Insights", () => {
  it("sends full detail to App Insights and nothing to console", () => {
    defaultClient = track;
    const err = new Error("boom\nline");
    logger.error("msg\nfull", err, { a: 1 });
    expect(track.trackException).toHaveBeenCalledWith(
      expect.objectContaining({ exception: err, properties: { message: "msg\nfull", a: 1 } })
    );
    logger.error("m2", "str", { b: 2 });
    expect(track.trackTrace).toHaveBeenCalledWith(
      expect.objectContaining({ message: "m2", properties: { error: "str", b: 2 } })
    );
  });
});
