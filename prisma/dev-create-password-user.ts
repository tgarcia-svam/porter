/**
 * DEV ONLY — bootstrap a local username/password account without needing SSO to
 * reach the admin UI. Upserts a PASSWORD user (as ADMIN so you can also open
 * /admin) and prints a set-password invite link. Run:
 *
 *   npx tsx prisma/dev-create-password-user.ts you@example.com
 *
 * Then open the printed link to set a password + enroll MFA. In real onboarding
 * this link is emailed; locally (ACS unset) the app also logs it to the dev console.
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient({
  datasources: process.env.DATABASE_URL_ADMIN
    ? { db: { url: process.env.DATABASE_URL_ADMIN } }
    : undefined,
});

async function main() {
  const email = (process.argv[2] || process.env.DEV_USER_EMAIL || "").toLowerCase();
  if (!email) {
    console.error("Usage: npx tsx prisma/dev-create-password-user.ts <email>");
    process.exit(1);
  }
  const base = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");

  const user = await prisma.user.upsert({
    where: { email },
    update: { authMethod: "PASSWORD" },
    create: { email, name: email.split("@")[0], role: "ADMIN", authMethod: "PASSWORD" },
  });

  const raw = crypto.randomBytes(32).toString("base64url");
  await prisma.authToken.create({
    data: {
      userId: user.id,
      tokenHash: crypto.createHash("sha256").update(raw).digest("hex"),
      purpose: "INVITE",
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    },
  });

  console.log(`\nUser ready: ${email} (ADMIN, PASSWORD)`);
  console.log(`Set-password link (expires 72h):\n${base}/account/set-password?token=${encodeURIComponent(raw)}\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
