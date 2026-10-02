import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

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
  // or local password. Default is PASSWORD so the seed admin can always log in
  // without requiring a Google/Entra SSO app to be configured.
  const authMethod = (process.env.SEED_ADMIN_AUTHMETHOD ?? "PASSWORD") === "PASSWORD"
    ? "PASSWORD"
    : "SSO";

  await prisma.user.upsert({
    where:  { email: adminEmail },
    update: { role: "ADMIN", authMethod },
    create: { email: adminEmail, name: "Admin", role: "ADMIN", authMethod },
  });

  // When switching to PASSWORD auth, set an initial password from SEED_ADMIN_PASSWORD
  // only if the user does not already have one — preserving any password the admin
  // has already set via the normal reset/invite flow.
  if (authMethod === "PASSWORD") {
    const existing = await prisma.user.findUnique({
      where:  { email: adminEmail },
      select: { passwordHash: true },
    });
    const seedPassword = process.env.SEED_ADMIN_PASSWORD;
    if (!existing?.passwordHash && seedPassword) {
      const passwordHash = await bcrypt.hash(seedPassword, 12);
      await prisma.user.update({
        where: { email: adminEmail },
        data:  { passwordHash, passwordChangedAt: new Date() },
      });
      console.log(`  PASSWORD set for ${adminEmail} from SEED_ADMIN_PASSWORD`);
    } else if (!existing?.passwordHash && !seedPassword) {
      console.warn(`  WARNING: ${adminEmail} has authMethod=PASSWORD but no passwordHash and SEED_ADMIN_PASSWORD is not set.`);
      console.warn(`  Use the admin UI "Resend invite" to send a set-password email, or set SEED_ADMIN_PASSWORD.`);
    }
  }

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
  }

  // Back-fill passwordChangedAt for existing PASSWORD users who lack it (grace period).
  await prisma.user.updateMany({
    where: { passwordChangedAt: null, authMethod: "PASSWORD" },
    data:  { passwordChangedAt: new Date() },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
