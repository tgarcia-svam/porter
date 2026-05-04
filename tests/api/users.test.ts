import { test, expect } from "@playwright/test";
import { apiPost, apiDelete } from "./helpers";

const TEST_EMAIL = `pw-user-${Date.now()}@porter.test`;

test.describe("GET /api/users", () => {
  test("returns 200 with array of users", async ({ request }) => {
    const res = await request.get("/api/users");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("returns 403 without authentication", async ({ playwright }) => {
    // Use a fully isolated API context with no storage state
    const ctx = await playwright.request.newContext({ baseURL: "http://localhost:3000", storageState: { cookies: [], origins: [] } });
    const res = await ctx.get("/api/users");
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });
});

test.describe("POST /api/users", () => {
  test("creates a new user and returns 201", async ({ request }) => {
    const res = await apiPost(request, "/api/users", {
      email: TEST_EMAIL,
      name: "Playwright User",
      role: "UPLOADER",
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.email).toBe(TEST_EMAIL);
    expect(body.role).toBe("UPLOADER");
  });

  test("returns 409 when email already exists", async ({ request }) => {
    const res = await apiPost(request, "/api/users", {
      email: "playwright-admin@porter.test",
      role: "ADMIN",
    });
    expect(res.status()).toBe(409);
  });

  test("returns 400 for invalid email", async ({ request }) => {
    const res = await apiPost(request, "/api/users", {
      email: "not-an-email",
      role: "UPLOADER",
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("DELETE /api/users/:id", () => {
  test("deletes the created test user", async ({ request }) => {
    const listRes = await request.get("/api/users");
    const users = await listRes.json();
    const target = users.find((u: { email: string }) => u.email === TEST_EMAIL);
    if (!target) test.skip();

    const res = await apiDelete(request, `/api/users/${target.id}`);
    expect([200, 204]).toContain(res.status());
  });
});
