import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, withHandler } from "@/lib/api-error";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";

const KEYS = ["PASSWORD_EXPIRY_DAYS", "MAX_CONCURRENT_SESSIONS"] as const;

type SecuritySettings = { passwordExpiryDays: number; maxConcurrentSessions: number };

async function getSettings(): Promise<SecuritySettings> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [...KEYS] } } });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    passwordExpiryDays:     parseInt(map["PASSWORD_EXPIRY_DAYS"]    ?? "0"),
    maxConcurrentSessions:  parseInt(map["MAX_CONCURRENT_SESSIONS"] ?? "0"),
  };
}

const UpdateBody = z.object({
  passwordExpiryDays:    z.number().int().min(0).optional(),
  maxConcurrentSessions: z.number().int().min(0).optional(),
});

export const GET = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();
  return NextResponse.json(await getSettings());
});

export const PUT = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const parsed = UpdateBody.safeParse(await req.json());
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  const updates: { key: string; value: string }[] = [];
  if (parsed.data.passwordExpiryDays !== undefined)
    updates.push({ key: "PASSWORD_EXPIRY_DAYS", value: String(parsed.data.passwordExpiryDays) });
  if (parsed.data.maxConcurrentSessions !== undefined)
    updates.push({ key: "MAX_CONCURRENT_SESSIONS", value: String(parsed.data.maxConcurrentSessions) });

  await Promise.all(
    updates.map(({ key, value }) =>
      prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  );

  return NextResponse.json(await getSettings());
});
