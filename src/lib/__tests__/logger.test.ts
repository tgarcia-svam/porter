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

describe("logger console fallback", () => {
  const spies = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
  beforeEach(() => {
    defaultClient = undefined;
    Object.values(spies).forEach((s) => s.mockClear());
  });
  afterEach(() => vi.clearAllMocks());

  it("prints a single clean line for CRLF/ANSI injection", () => {
    logger.error("login failed\r\n[auth] forged \u001b[31mred", new Error("bad\nline"));
    const line = spies.error.mock.calls[0][0] as string;
    expect(spies.error.mock.calls[0]).toHaveLength(1);
    expect(line).toMatch(/^[A-Za-z0-9 _.:\-[\]|]+$/);
    expect(line).not.toMatch(/[\r\n\u001b]/);
  });

  it("caps length and never prints stack text", () => {
    const err = new Error("x".repeat(1000));
    logger.error("m", err);
    const line = spies.error.mock.calls[0][0] as string;
    expect(line).not.toContain("at ");
    expect(line.length).toBeLessThan(500);
  });

  it("routes info and warn to the right console methods", () => {
    logger.info("hello\nworld");
    logger.warn("careful");
    expect(spies.log.mock.calls[0][0]).toBe("hello_world");
    expect(spies.warn.mock.calls[0][0]).toBe("careful");
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
