// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch } from "../apiFetch";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/`;
}

function clearCookies() {
  document.cookie.split(";").forEach((c) => {
    const key = c.trim().split("=")[0];
    if (key) document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
}

const mockFetch = vi.fn();

beforeEach(() => {
  clearCookies();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", mockFetch);
});

// ── Non-mutating methods ──────────────────────────────────────────────────────

describe("non-mutating methods (GET, HEAD, OPTIONS)", () => {
  it("passes through GET without injecting CSRF header", async () => {
    setCookie("csrf-token", "mytoken");
    await apiFetch("/api/data");
    const [, init] = mockFetch.mock.calls[0];
    expect(init).toBeUndefined();
  });

  it("passes through explicit GET without CSRF header", async () => {
    setCookie("csrf-token", "mytoken");
    await apiFetch("/api/data", { method: "GET" });
    const [, init] = mockFetch.mock.calls[0];
    expect(new Headers(init?.headers).has("x-csrf-token")).toBe(false);
  });
});

// ── Mutating methods ──────────────────────────────────────────────────────────

describe("mutating methods (POST, PUT, DELETE, PATCH)", () => {
  it.each(["POST", "PUT", "DELETE", "PATCH"])(
    "injects x-csrf-token header for %s",
    async (method) => {
      setCookie("csrf-token", "testtoken123");
      await apiFetch("/api/data", { method });
      const [, init] = mockFetch.mock.calls[0];
      expect(new Headers(init.headers).get("x-csrf-token")).toBe("testtoken123");
    }
  );

  it("preserves existing headers alongside the CSRF header", async () => {
    setCookie("csrf-token", "tok");
    await apiFetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("x-csrf-token")).toBe("tok");
  });

  it("spreads init options through to fetch", async () => {
    setCookie("csrf-token", "tok");
    const body = JSON.stringify({ key: "value" });
    await apiFetch("/api/data", { method: "POST", body });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.body).toBe(body);
  });
});

// ── Cookie parsing ────────────────────────────────────────────────────────────

describe("CSRF cookie reading", () => {
  it("injects empty string when csrf-token cookie is absent", async () => {
    await apiFetch("/api/data", { method: "POST" });
    const [, init] = mockFetch.mock.calls[0];
    expect(new Headers(init.headers).get("x-csrf-token")).toBe("");
  });

  it("reads the correct cookie when multiple cookies are set", async () => {
    setCookie("other-cookie", "ignore-me");
    setCookie("csrf-token", "correct-token");
    await apiFetch("/api/data", { method: "POST" });
    const [, init] = mockFetch.mock.calls[0];
    expect(new Headers(init.headers).get("x-csrf-token")).toBe("correct-token");
  });

  it("passes the URL through to fetch unchanged", async () => {
    await apiFetch("/api/resource", { method: "POST" });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/resource");
  });
});
