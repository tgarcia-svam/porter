import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_USERS = [
  {
    email: "admin@porter.local",
    name: "Default Admin",
    role: "ADMIN" as const,
    password: "admin",
  },
  {
    email: "uploader@porter.local",
    name: "Default Uploader",
    role: "UPLOADER" as const,
    password: "uploader",
  },
];

async function main() {
  // Seed default credential users
  for (const u of DEFAULT_USERS) {
    const hashed = await bcrypt.hash(u.password, 12);
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role, password: hashed },
      create: { email: u.email, name: u.name, role: u.role, password: hashed },
    });
    console.log(`  ${user.role.padEnd(8)} ${user.email}  (password: ${u.password})`);
  }

  // Optionally seed an extra admin from env
  const envAdmin = process.env.SEED_ADMIN_EMAIL;
  if (envAdmin && !DEFAULT_USERS.find((u) => u.email === envAdmin)) {
    const user = await prisma.user.upsert({
      where: { email: envAdmin },
      update: { role: "ADMIN" },
      create: { email: envAdmin, name: "Admin", role: "ADMIN" },
    });
    console.log(`  ADMIN    ${user.email}  (SSO only)`);
  }

  console.log("\nDefault accounts ready.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
