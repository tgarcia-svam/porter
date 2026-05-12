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

  const user = await prisma.user.upsert({
    where:  { email: adminEmail },
    update: { role: "ADMIN" },
    create: { email: adminEmail, name: "Admin", role: "ADMIN" },
  });

  console.log(`  ADMIN  ${user.email}  (SSO only)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
