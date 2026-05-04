import { test, expect } from "@playwright/test";
import { apiPost, apiDelete } from "./helpers";

const SCHEMA_NAME = `PW Schema ${Date.now()}`;

const BASE_SCHEMA = {
  name: SCHEMA_NAME,
  description: "Created by Playwright tests",
  columns: [
    { name: "Name", dataType: "TEXT", required: true, order: 0 },
    { name: "Score", dataType: "NUMBER", required: true, order: 1 },
    { name: "Active", dataType: "BOOLEAN", required: false, order: 2 },
  ],
};

test.describe("GET /api/schemas", () => {
  test("returns 200 with array", async ({ request }) => {
    const res = await request.get("/api/schemas");
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test("returns 403 without auth", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: "http://localhost:3000", storageState: { cookies: [], origins: [] } });
    const res = await ctx.get("/api/schemas");
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });
});

test.describe("POST /api/schemas", () => {
  test("creates a schema with columns and returns 201", async ({ request }) => {
    const res = await apiPost(request, "/api/schemas", BASE_SCHEMA);
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe(SCHEMA_NAME);
    expect(body.columns).toHaveLength(3);
  });

  test("returns 400 when columns array is empty", async ({ request }) => {
    const res = await apiPost(request, "/api/schemas", {
      name: "Bad Schema",
      columns: [],
    });
    expect(res.status()).toBe(400);
  });

  test("returns 400 when columns are missing", async ({ request }) => {
    const res = await apiPost(request, "/api/schemas", { name: "No Cols" });
    expect(res.status()).toBe(400);
  });
});

test.describe("GET /api/schemas/:id", () => {
  test("returns the schema with columns and projects", async ({ request }) => {
    const listRes = await request.get("/api/schemas");
    const schemas: Array<{ id: string; name: string }> = await listRes.json();
    const target = schemas.find((s) => s.name === SCHEMA_NAME);
    if (!target) return test.skip();

    const res = await request.get(`/api/schemas/${target.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(target.id);
    expect(Array.isArray(body.columns)).toBe(true);
  });

  test("returns 404 for unknown id", async ({ request }) => {
    const res = await request.get("/api/schemas/no-such-schema-00000000");
    expect(res.status()).toBe(404);
  });
});

test.describe("DELETE /api/schemas/:id", () => {
  test("deletes the test schema", async ({ request }) => {
    const listRes = await request.get("/api/schemas");
    const schemas: Array<{ id: string; name: string }> = await listRes.json();
    const target = schemas.find((s) => s.name === SCHEMA_NAME);
    if (!target) return test.skip();

    const res = await apiDelete(request, `/api/schemas/${target.id}`);
    expect([200, 204]).toContain(res.status());

    // Verify it's gone
    const checkRes = await request.get(`/api/schemas/${target.id}`);
    expect(checkRes.status()).toBe(404);
  });
});
