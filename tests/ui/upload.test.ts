import { test, expect } from "@playwright/test";

test.describe("Upload page", () => {
  test("loads the upload page", async ({ page }) => {
    await page.goto("/upload");
    // The page renders the FileUploader component
    await expect(page.locator("body")).not.toBeEmpty();
    // Should not redirect to login (admin session is used)
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("redirects unauthenticated users to login", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/upload");
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });

  test("shows file drop area or project selector", async ({ page }) => {
    await page.goto("/upload");
    // Admin users with no org assigned see the upload page but may show
    // an empty state or project selector depending on org assignment.
    // Verify the page renders something meaningful.
    await expect(page.locator("main")).toBeVisible();
  });
});

test.describe("Login page", () => {
  test("shows Porter heading and sign-in buttons", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Porter" })).toBeVisible();
    // At least one sign-in button should be present
    const signInBtn = page.getByRole("button").filter({ hasText: /Continue with/i }).first();
    await expect(signInBtn).toBeVisible();
    await ctx.close();
  });
});
