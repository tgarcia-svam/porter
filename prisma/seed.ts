import { PrismaClient } from "@prisma/client";

// Seed runs with admin credentials — use DATABASE_URL_ADMIN when set so it
// connects as the BYPASSRLS / owner role even after DATABASE_URL is switched
// to porterapp. Naming matches docker-entrypoint.sh and bicep app settings.
const prisma = new PrismaClient({
  datasources: process.env.DATABASE_URL_ADMIN
    ? { db: { url: process.env.DATABASE_URL_ADMIN } }
    : undefined,
});

async function main() {
  const raw = process.env.SEED_ADMIN_EMAIL;
  if (!raw) {
    console.error("SEED_ADMIN_EMAIL is not set. Set it to the email address of the initial admin user.");
    process.exit(1);
  }
  const adminEmail = raw.toLowerCase();

  // Seed admin signs in via SSO (Google / Microsoft) — not a local password.
  // Pin authMethod to SSO on both create AND update: the migration backfills
  // existing rows to SSO, but a local `prisma db push` (which skips migration SQL)
  // leaves them at the PASSWORD column default, which would block SSO sign-in.
  // Forcing SSO here guarantees the bootstrap admin can always authenticate.
  const user = await prisma.user.upsert({
    where:  { email: adminEmail },
    update: { role: "ADMIN", authMethod: "SSO" },
    create: { email: adminEmail, name: "Admin", role: "ADMIN", authMethod: "SSO" },
  });

  console.log(`  ADMIN  ${user.email}  (SSO)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
