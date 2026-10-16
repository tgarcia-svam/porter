import { test, expect } from "@playwright/test";

test.describe("Admin analytics (landing page)", () => {
  test("/admin redirects to Analytics", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/analytics/);
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  });

  test("shows the Project Data and App Usage tabs", async ({ page }) => {
    await page.goto("/admin/analytics");
    const tabs = page.getByRole("navigation", { name: "Analytics tabs" });
    await expect(tabs.getByRole("button", { name: "Project Data" })).toBeVisible();
    await expect(tabs.getByRole("button", { name: "App Usage" })).toBeVisible();
  });

  test("shows the project picker on Project Data", async ({ page }) => {
    await page.goto("/admin/analytics");
    await expect(page.getByText("Pick a project and file format")).toBeVisible();
  });

  test("redirects unauthenticated users to login", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });
});

test.describe("Admin users page", () => {
  test("loads and shows Users heading", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  });

  test("shows Add User button", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByRole("button", { name: /add user/i })).toBeVisible();
  });

  test("shows the test admin in the user list", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByText("playwright-admin@porter.test")).toBeVisible();
  });
});

test.describe("Admin schemas page", () => {
  test("loads and shows File Formats heading", async ({ page }) => {
    await page.goto("/admin/schemas");
    // Heading may be "File Formats" or "Schemas"
    await expect(
      page.getByRole("heading").filter({ hasText: /format|schema/i }).first()
    ).toBeVisible();
  });
});

test.describe("Admin navigation", () => {
  test("sidebar links navigate correctly", async ({ page }) => {
    await page.goto("/admin");
    const usersLink = page.getByRole("link", { name: /users/i }).first();
    await usersLink.click();
    await expect(page).toHaveURL(/\/admin\/users/);
  });
});
