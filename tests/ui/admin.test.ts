import { test, expect } from "@playwright/test";

test.describe("Admin dashboard", () => {
  test("loads the dashboard page", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("shows stat cards for Users, File Formats, Total Uploads", async ({ page }) => {
    await page.goto("/admin");
    const main = page.getByRole("main");
    await expect(main.getByText("Users", { exact: true }).first()).toBeVisible();
    await expect(main.getByText("File Formats", { exact: true })).toBeVisible();
    await expect(main.getByText("Total Uploads", { exact: true })).toBeVisible();
  });

  test("shows Recent Uploads section", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText("Recent Uploads")).toBeVisible();
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
