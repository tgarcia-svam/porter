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

  // SEED_ADMIN_AUTHMETHOD controls whether the bootstrap admin signs in via SSO
  // or local password. Default is SSO for self-hosted deployments; set to PASSWORD
  // when provisioned by porter-platform (SaaS) so the admin can set a password
  // via the invite flow without needing a Google/Entra SSO app configured.
  const authMethod = (process.env.SEED_ADMIN_AUTHMETHOD ?? "SSO") === "PASSWORD"
    ? "PASSWORD"
    : "SSO";

  const user = await prisma.user.upsert({
    where:  { email: adminEmail },
    update: { role: "ADMIN", authMethod },
    create: { email: adminEmail, name: "Admin", role: "ADMIN", authMethod },
  });

  console.log(`  ADMIN  ${user.email}  (${authMethod})`);

  // Default security-policy AppSettings — only insert when absent so existing
  // admin-configured values are preserved.
  for (const [key, value] of [
    ["PASSWORD_EXPIRY_DAYS",    "0"],  // 0 = disabled
    ["MAX_CONCURRENT_SESSIONS", "0"],  // 0 = unlimited
  ] as [string, string][]) {
    await prisma.appSetting.upsert({
      where:  { key },
      update: {},  // never overwrite an existing admin-set value
      create: { key, value },
    });
    console.log(`  SETTING  ${key} = ${value}`);
  }

  // Back-fill passwordChangedAt for existing PASSWORD users who lack it (grace period).
  const { count } = await prisma.user.updateMany({
    where: { passwordChangedAt: null, authMethod: "PASSWORD" },
    data:  { passwordChangedAt: new Date() },
  });
  if (count > 0) console.log(`  BACKFILL  passwordChangedAt set for ${count} PASSWORD user(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
