import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public endpoint — no auth required.
// Returns only which SSO providers are active (no secrets exposed).
export async function GET() {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "AZURE_AD_CLIENT_ID",
          "AZURE_AD_CLIENT_SECRET",
        ],
      },
    },
  });
  const db = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));

  return NextResponse.json({
    google:
      !!(db.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID) &&
      !!(db.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET),
    microsoft:
      !!(db.AZURE_AD_CLIENT_ID ?? process.env.AZURE_AD_CLIENT_ID) &&
      !!(db.AZURE_AD_CLIENT_SECRET ?? process.env.AZURE_AD_CLIENT_SECRET),
  });
}
