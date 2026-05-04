import { test, expect } from "@playwright/test";
import { apiPost, apiPut, apiDelete } from "./helpers";

const ORG_NAME = `PW Org ${Date.now()}`;

test.describe("GET /api/organizations", () => {
  test("returns 200 with array", async ({ request }) => {
    const res = await request.get("/api/organizations");
    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test("returns 403 without auth", async ({ playwright }) => {
    // Use a fully isolated API context with no storage state
    const ctx = await playwright.request.newContext({ baseURL: "http://localhost:3000", storageState: { cookies: [], origins: [] } });
    const res = await ctx.get("/api/organizations");
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });
});

test.describe("POST /api/organizations", () => {
  test("creates an organization and returns 201", async ({ request }) => {
    const res = await apiPost(request, "/api/organizations", { name: ORG_NAME });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe(ORG_NAME);
    expect(typeof body.id).toBe("string");
  });

  test("returns 400 for missing name", async ({ request }) => {
    const res = await apiPost(request, "/api/organizations", { name: "" });
    expect(res.status()).toBe(400);
  });
});

test.describe("PUT /api/organizations/:id", () => {
  test("updates the organization name", async ({ request }) => {
    const listRes = await request.get("/api/organizations");
    const orgs: Array<{ id: string; name: string }> = await listRes.json();
    const target = orgs.find((o) => o.name === ORG_NAME);
    if (!target) test.skip();

    const res = await apiPut(request, `/api/organizations/${target.id}`, {
      name: `${ORG_NAME} Updated`,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toBe(`${ORG_NAME} Updated`);
  });
});

test.describe("DELETE /api/organizations/:id", () => {
  test("deletes the created organization", async ({ request }) => {
    const listRes = await request.get("/api/organizations");
    const orgs: Array<{ id: string; name: string }> = await listRes.json();
    const target = orgs.find(
      (o) => o.name === ORG_NAME || o.name === `${ORG_NAME} Updated`,
    );
    if (!target) test.skip();

    const res = await apiDelete(request, `/api/organizations/${target.id}`);
    expect([200, 204]).toContain(res.status());
  });
});
