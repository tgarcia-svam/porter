// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch, resetCsrfCache } from "../apiFetch";

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
let tokenCounter = 0;

function defaultImpl(url: string) {
  if (url === "/api/csrf") {
    tokenCounter += 1;
    return Promise.resolve(Response.json({ token: `token-${tokenCounter}` }));
  }
  return Promise.resolve(new Response("ok", { status: 200 }));
}

const apiCalls = () => mockFetch.mock.calls.filter(([u]) => u !== "/api/csrf");
const csrfCalls = () => mockFetch.mock.calls.filter(([u]) => u === "/api/csrf");

beforeEach(() => {
  tokenCounter = 0;
  resetCsrfCache();
  mockFetch.mockReset();
  mockFetch.mockImplementation(defaultImpl);
  vi.stubGlobal("fetch", mockFetch);
});

// ── Non-mutating methods ──────────────────────────────────────────────────────

describe("non-mutating methods (GET, HEAD, OPTIONS)", () => {
  it("passes through GET without fetching or injecting a CSRF token", async () => {
    await apiFetch("/api/data");
    expect(csrfCalls()).toHaveLength(0);
    const [, init] = apiCalls()[0];
    expect(init).toBeUndefined();
  });

  it("passes through explicit GET without CSRF header", async () => {
    await apiFetch("/api/data", { method: "GET" });
    const [, init] = apiCalls()[0];
    expect(new Headers(init?.headers).has("x-csrf-token")).toBe(false);
  });
});

// ── Mutating methods ──────────────────────────────────────────────────────────

describe("mutating methods (POST, PUT, DELETE, PATCH)", () => {
  it.each(["POST", "PUT", "DELETE", "PATCH"])(
    "injects the token from /api/csrf for %s",
    async (method) => {
      await apiFetch("/api/data", { method });
      const [, init] = apiCalls()[0];
      expect(new Headers(init.headers).get("x-csrf-token")).toBe("token-1");
    }
  );

  it("preserves existing headers alongside the CSRF header", async () => {
    await apiFetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const headers = new Headers(apiCalls()[0][1].headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("x-csrf-token")).toBe("token-1");
  });

  it("spreads init options through to fetch", async () => {
    const body = JSON.stringify({ key: "value" });
    await apiFetch("/api/data", { method: "POST", body });
    expect(apiCalls()[0][1].body).toBe(body);
  });

  it("passes a path with a query string through unchanged", async () => {
    await apiFetch("/api/items?page=2&q=a%20b");
    expect(mockFetch.mock.calls[0][0]).toBe("/api/items?page=2&q=a%20b");
  });
  it("passes the URL through to fetch unchanged", async () => {
    await apiFetch("/api/resource", { method: "POST" });
    expect(apiCalls()[0][0]).toBe("/api/resource");
  });
});

// ── Token caching and refresh ─────────────────────────────────────────────────

describe("token lifecycle", () => {
  it("fetches the token once and reuses it", async () => {
    await apiFetch("/api/a", { method: "POST" });
    await apiFetch("/api/b", { method: "PUT" });
    expect(csrfCalls()).toHaveLength(1);
  });

  it("refreshes the token and retries once after a CSRF rejection", async () => {
    let first = true;
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/csrf") return defaultImpl(url);
      if (first) {
        first = false;
        return Promise.resolve(new Response("Invalid CSRF token", { status: 403 }));
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    });
    const res = await apiFetch("/api/data", { method: "POST" });
    expect(res.status).toBe(200);
    expect(csrfCalls()).toHaveLength(2);
    expect(new Headers(apiCalls()[1][1].headers).get("x-csrf-token")).toBe("token-2");
  });

  it("does not retry on domain 403s", async () => {
    mockFetch.mockImplementation((url: string) =>
      url === "/api/csrf"
        ? defaultImpl(url)
        : Promise.resolve(new Response("cannot delete your own account", { status: 403 }))
    );
    const res = await apiFetch("/api/users/1", { method: "DELETE" });
    expect(res.status).toBe(403);
    expect(apiCalls()).toHaveLength(1);
  });

  it("rejects when the token endpoint fails", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(new Response("nope", { status: 500 })));
    await expect(apiFetch("/api/data", { method: "POST" })).rejects.toThrow();
  });
});

// ── Path safety ───────────────────────────────────────────────────────────────

describe("path safety", () => {
  it("rejects absolute URLs", async () => {
    await expect(apiFetch("https://evil.example/x", { method: "POST" })).rejects.toThrow();
  });
  it.each(["//evil.com/x", "/@evil.com/x", "/api/../x", "/x", "/api\evil", "/api/x\r\nHost: e", "api/x"])(
    "rejects %j",
    async (p) => {
      await expect(apiFetch(p)).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
});
