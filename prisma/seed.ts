import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
