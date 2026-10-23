// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

const ORIGIN = "http://localhost:3000";

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_ORIGINS", ORIGIN);
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

  it("sends an absolute URL on the allow-listed origin with the query percent-encoded", async () => {
    await apiFetch("/api/items?page=2&q=a%20b");
    expect(mockFetch.mock.calls[0][0]).toBe(`${ORIGIN}/api/items?page=2&q=a%20b`);
  });
  it("re-encodes query values (e.g. reserved characters)", async () => {
    await apiFetch("/api/items?q=a%26b%3Dc");
    expect(mockFetch.mock.calls[0][0]).toBe(`${ORIGIN}/api/items?q=a%26b%3Dc`);
  });
  it("sends the request to the allow-listed URL", async () => {
    await apiFetch("/api/resource", { method: "POST" });
    expect(apiCalls()[0][0]).toBe(`${ORIGIN}/api/resource`);
  });
  it("accepts record IDs in path segments", async () => {
    await apiFetch("/api/projects/cmabc123XYZ/organizations?organizationId=cmdef456", {
      method: "DELETE",
    });
    expect(apiCalls()[0][0]).toBe(
      `${ORIGIN}/api/projects/cmabc123XYZ/organizations?organizationId=cmdef456`
    );
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
  it.each([
    "//evil.com/x",
    "/@evil.com/x",
    "/api/../x",
    "/api/%2e%2e/x",
    "/api/a.b",
    "/api/a:b",
    "/api/a@b",
    "/api/a~b",
    "/api/a+b",
    "/api/a,b",
    "/api/",
    "/api",
    "/x",
    "/api" + String.fromCharCode(92) + "evil",
    "/api/x\r\nHost: e",
    "api/x",
    "/api/items?bad-key=1",
    "/api/items?a.b=1",
  ])("rejects %j", async (p) => {
    await expect(apiFetch(p)).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── Destination allowlist ─────────────────────────────────────────────────────

describe("destination allowlist", () => {
  it("rejects when the page host is not in NEXT_PUBLIC_APP_ORIGINS", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ORIGINS", "https://app.example.com");
    await expect(apiFetch("/api/data")).rejects.toThrow(/not an allowed API origin/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("rejects when the port differs", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ORIGINS", "http://localhost:4000");
    await expect(apiFetch("/api/data")).rejects.toThrow();
  });
  it("ignores plain-http entries for non-local hosts", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ORIGINS", "http://app.example.com");
    await expect(apiFetch("/api/data")).rejects.toThrow(/not configured/);
  });
  it("accepts any listed origin that matches the page", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ORIGINS", "https://app.example.com, http://localhost:3000");
    await apiFetch("/api/data");
    expect(mockFetch.mock.calls[0][0]).toBe(`${ORIGIN}/api/data`);
  });
  it("fails closed in production when the variable is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ORIGINS", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(apiFetch("/api/data")).rejects.toThrow(/not configured/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
