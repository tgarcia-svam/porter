import { test as setup, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const ADMIN_FILE = ".auth/admin.json";
const UPLOADER_FILE = ".auth/uploader.json";

const TEST_SECRET = process.env.PLAYWRIGHT_TEST_SECRET;
if (!TEST_SECRET) throw new Error("PLAYWRIGHT_TEST_SECRET env var is required for tests");

setup.beforeAll(() => {
  fs.mkdirSync(path.join(process.cwd(), ".auth"), { recursive: true });
});

setup("create admin session", async ({ page }) => {
  const response = await page.request.post("/api/auth/test-session", {
    data: {
      secret: TEST_SECRET,
      email: "playwright-admin@porter.test",
      role: "ADMIN",
    },
  });
  expect(response.ok(), `test-session failed: ${await response.text()}`).toBeTruthy();
  await page.context().storageState({ path: ADMIN_FILE });
});

setup("create uploader session", async ({ page }) => {
  const response = await page.request.post("/api/auth/test-session", {
    data: {
      secret: TEST_SECRET,
      email: "playwright-uploader@porter.test",
      role: "UPLOADER",
    },
  });
  expect(response.ok(), `test-session failed: ${await response.text()}`).toBeTruthy();
  await page.context().storageState({ path: UPLOADER_FILE });
});
