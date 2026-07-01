/**
 * DEV ONLY — local equivalent of the local_auth migration's SSO backfill.
 *
 * `prisma db push` (used for local dev) applies the new authMethod column with its
 * PASSWORD default but does NOT run migration SQL, so pre-existing users end up as
 * PASSWORD and can't sign in with SSO. This designates them SSO. It only touches
 * users that have no local password and no MFA (i.e. never onboarded as password
 * accounts), so any account you've genuinely set up with a password is left alone.
 *
 *   npx tsx prisma/dev-backfill-sso.ts
 *
 * In production this is unnecessary — `prisma migrate deploy` backfills automatically.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: process.env.DATABASE_URL_ADMIN
    ? { db: { url: process.env.DATABASE_URL_ADMIN } }
    : undefined,
});

async function main() {
  const result = await prisma.user.updateMany({
    where: { authMethod: "PASSWORD", passwordHash: null, mfaEnabled: false },
    data: { authMethod: "SSO" },
  });
  console.log(`Designated ${result.count} existing user(s) as SSO.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
