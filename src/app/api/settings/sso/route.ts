import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, invalidateAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { auditStore, clientIp } from "@/lib/audit-context";

type SettingSource = "db" | "env" | null;

const SSO_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AZURE_AD_CLIENT_ID",
  "AZURE_AD_CLIENT_SECRET",
  "AZURE_AD_TENANT_ID",
] as const;

type SSOKey = (typeof SSO_KEYS)[number];

async function getSSOStatus() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [...SSO_KEYS] } },
  });
  const db = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));

  function source(key: SSOKey): SettingSource {
    if (key in db) return "db";
    if (process.env[key]) return "env";
    return null;
  }

  const googleConfigured =
    !!(db.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID) &&
    !!(db.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET);

  const msConfigured =
    !!(db.AZURE_AD_CLIENT_ID ?? process.env.AZURE_AD_CLIENT_ID) &&
    !!(db.AZURE_AD_CLIENT_SECRET ?? process.env.AZURE_AD_CLIENT_SECRET);

  const msTenantId =
    db.AZURE_AD_TENANT_ID ?? process.env.AZURE_AD_TENANT_ID ?? "common";

  return {
    google: {
      configured: googleConfigured,
      clientIdSource: source("GOOGLE_CLIENT_ID"),
      clientSecretSource: source("GOOGLE_CLIENT_SECRET"),
    },
    microsoft: {
      configured: msConfigured,
      clientIdSource: source("AZURE_AD_CLIENT_ID"),
      clientSecretSource: source("AZURE_AD_CLIENT_SECRET"),
      tenantId: msTenantId,
      tenantIdSource: source("AZURE_AD_TENANT_ID") ?? ("default" as const),
    },
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await getSSOStatus());
}

const UpdateBody = z.object({
  googleClientId: z.string().optional(),
  googleClientSecret: z.string().optional(),
  msClientId: z.string().optional(),
  msClientSecret: z.string().optional(),
  msTenantId: z.string().optional(),
});

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  auditStore.enterWith({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    ip: clientIp(req),
  });

  const body = await req.json();
  const parsed = UpdateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { googleClientId, googleClientSecret, msClientId, msClientSecret, msTenantId } =
    parsed.data;

  const toUpsert: [SSOKey, string][] = [];
  if (googleClientId?.trim())    toUpsert.push(["GOOGLE_CLIENT_ID",      googleClientId.trim()]);
  if (googleClientSecret?.trim()) toUpsert.push(["GOOGLE_CLIENT_SECRET",   googleClientSecret.trim()]);
  if (msClientId?.trim())        toUpsert.push(["AZURE_AD_CLIENT_ID",     msClientId.trim()]);
  if (msClientSecret?.trim())    toUpsert.push(["AZURE_AD_CLIENT_SECRET", msClientSecret.trim()]);
  if (msTenantId?.trim())        toUpsert.push(["AZURE_AD_TENANT_ID",     msTenantId.trim()]);

  await Promise.all(
    toUpsert.map(([key, value]) =>
      prisma.appSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  );

  // Rebuild the NextAuth instance on the next request with the new credentials
  invalidateAuth();

  return NextResponse.json(await getSSOStatus());
}
