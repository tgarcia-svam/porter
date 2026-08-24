import { PrismaClient } from "@prisma/client";

const APP_USER = "porterapp";

async function main() {
  const password = process.env.PORTER_APP_USER_PASSWORD;
  if (!password) {
    console.error("Error: PORTER_APP_USER_PASSWORD env var is required.");
    console.error("  Example: PORTER_APP_USER_PASSWORD=<strong-password> npm run db:create-app-user");
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl) {
    console.error("Error: DATABASE_URL env var is not set (admin credentials required).");
    process.exit(1);
  }

  // Extract database name from DATABASE_URL path component
  let dbName: string;
  try {
    const parsed = new URL(dbUrl.replace(/^postgresql:\/\//, "http://"));
    dbName = parsed.pathname.slice(1).split("?")[0];
    if (!dbName) throw new Error("empty path");
  } catch {
    console.error("Error: Could not parse database name from DATABASE_URL.");
    process.exit(1);
  }

  const escapedPassword = password.replace(/'/g, "''");

  const prisma = new PrismaClient();
  try {
    // Create role or update password if it already exists
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_USER}') THEN
          CREATE ROLE ${APP_USER} WITH LOGIN PASSWORD '${escapedPassword}';
          RAISE NOTICE 'Role ${APP_USER} created.';
        ELSE
          ALTER ROLE ${APP_USER} WITH PASSWORD '${escapedPassword}';
          RAISE NOTICE 'Role ${APP_USER} already exists — password updated.';
        END IF;
      END $$
    `);
    console.log(`[1/6] Role '${APP_USER}' ready.`);

    await prisma.$executeRawUnsafe(
      `GRANT CONNECT ON DATABASE "${dbName}" TO ${APP_USER}`
    );
    console.log(`[2/6] GRANT CONNECT ON DATABASE "${dbName}".`);

    await prisma.$executeRawUnsafe(
      `GRANT USAGE ON SCHEMA public TO ${APP_USER}`
    );
    console.log("[3/6] GRANT USAGE ON SCHEMA public.");

    await prisma.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_USER}`
    );
    console.log("[4/6] GRANT SELECT/INSERT/UPDATE/DELETE ON ALL TABLES.");

    await prisma.$executeRawUnsafe(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_USER}`
    );
    console.log("[5/6] GRANT USAGE, SELECT ON ALL SEQUENCES.");

    // Ensure future tables created by migrations also get the grants
    await prisma.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_USER}`
    );
    await prisma.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_USER}`
    );
    console.log("[6/6] ALTER DEFAULT PRIVILEGES set for future tables.");

    // Derive the app-user DATABASE_URL from the admin URL
    const appDbUrl = dbUrl.replace(
      /^postgresql:\/\/[^:]+:[^@]+@/,
      `postgresql://${APP_USER}:${encodeURIComponent(password)}@`
    );

    const maskedAppDbUrl = appDbUrl.replace(/:([^:@]+)@/, ":****@");
    console.log("\nDone. App user DATABASE_URL:");
    console.log(maskedAppDbUrl);
    console.log(
      "\nAdd this as DATABASE_URL in .env (or Key Vault) for application runtime."
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
