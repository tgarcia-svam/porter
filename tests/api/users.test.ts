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

  test("returns 403 without authentication", async ({ browser }) => {
    const ctx = await browser.newContext(); // fresh context — no auth cookies
    const res = await ctx.request.get("/api/users");
    expect(res.status()).toBe(403);
    await ctx.close();
  });
});

test.describe("POST /api/users", () => {
  let createdId: string;

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
    createdId = body.id;
  });

  test("returns 409 when email already exists", async ({ request }) => {
    const res = await apiPost(request, "/api/users", {
      email: "playwright-admin@porter.test", // created by auth setup
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

test.describe("GET /api/users/:id", () => {
  test("returns 200 with user data", async ({ request }) => {
    // Use the admin test user created during setup
    const listRes = await request.get("/api/users");
    const users = await listRes.json();
    const admin = users.find((u: { email: string }) =>
      u.email === "playwright-admin@porter.test"
    );
    expect(admin).toBeDefined();

    const res = await request.get(`/api/users/${admin.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(admin.id);
  });

  test("returns 404 for unknown id", async ({ request }) => {
    const res = await request.get("/api/users/nonexistent-id-00000000");
    expect(res.status()).toBe(404);
  });
});

test.describe("DELETE /api/users/:id", () => {
  test("deletes the created test user", async ({ request }) => {
    // Find the user created in the POST test
    const listRes = await request.get("/api/users");
    const users = await listRes.json();
    const target = users.find((u: { email: string }) => u.email === TEST_EMAIL);
    if (!target) test.skip(); // POST test may not have run

    const res = await apiDelete(request, `/api/users/${target.id}`);
    expect([200, 204]).toContain(res.status());
  });
});
