import { defineConfig } from "vitest/config";
import path from "path";

// Integration tests run against a live Postgres. They exercise RLS policies
// and other DB-backed behaviour that the unit suite mocks out.
//
// Run with:   npm run test:integration
//
// Required env vars:
//   DATABASE_URL         — porterapp role (RLS-enforced). Used by `prisma`.
//   DATABASE_URL_ADMIN   — superuser/owner (BYPASSRLS). Used to seed/teardown
//                          and to verify rows exist independent of RLS.
//
// Apply RLS policies once before running:  npm run db:rls
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["node_modules/**"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
