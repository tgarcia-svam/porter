import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, withHandler } from "@/lib/api-error";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";

const KEYS = [
  "PASSWORD_EXPIRY_DAYS",
  "PASSWORD_MIN_LENGTH",
  "PASSWORD_MIN_CLASSES",
  "PASSWORD_MIN_AGE_HOURS",
  "PASSWORD_HISTORY_COUNT",
  "PASSWORD_CUSTOM_DICTIONARY",
  "MAX_CONCURRENT_SESSIONS",
  "ABSOLUTE_SESSION_TIMEOUT_HOURS",
] as const;

type SecuritySettings = {
  // Session controls
  absoluteSessionTimeoutHours: number;
  maxConcurrentSessions:       number;
  // Password complexity
  passwordMinLength:           number;
  passwordMinClasses:          number;
  passwordCustomDictionary:    string;
  // Password lifecycle
  passwordExpiryDays:          number;
  passwordMinAgeHours:         number;
  passwordHistoryCount:        number;
};

async function getSettings(): Promise<SecuritySettings> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [...KEYS] } } });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    absoluteSessionTimeoutHours: parseInt(map["ABSOLUTE_SESSION_TIMEOUT_HOURS"]  ?? "8"),
    maxConcurrentSessions:       parseInt(map["MAX_CONCURRENT_SESSIONS"]         ?? "0"),
    passwordMinLength:           parseInt(map["PASSWORD_MIN_LENGTH"]             ?? "15"),
    passwordMinClasses:          parseInt(map["PASSWORD_MIN_CLASSES"]            ?? "3"),
    passwordCustomDictionary:    map["PASSWORD_CUSTOM_DICTIONARY"]               ?? "",
    passwordExpiryDays:          parseInt(map["PASSWORD_EXPIRY_DAYS"]            ?? "0"),
    passwordMinAgeHours:         parseInt(map["PASSWORD_MIN_AGE_HOURS"]          ?? "0"),
    passwordHistoryCount:        parseInt(map["PASSWORD_HISTORY_COUNT"]          ?? "0"),
  };
}

const UpdateBody = z.object({
  absoluteSessionTimeoutHours: z.number().int().min(0).optional(),
  maxConcurrentSessions:       z.number().int().min(0).optional(),
  passwordMinLength:           z.number().int().min(8).optional(),
  passwordMinClasses:          z.number().int().min(1).max(4).optional(),
  passwordCustomDictionary:    z.string().max(10_000).optional(),
  passwordExpiryDays:          z.number().int().min(0).optional(),
  passwordMinAgeHours:         z.number().int().min(0).optional(),
  passwordHistoryCount:        z.number().int().min(0).max(24).optional(),
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
  const d = parsed.data;
  if (d.absoluteSessionTimeoutHours !== undefined)
    updates.push({ key: "ABSOLUTE_SESSION_TIMEOUT_HOURS",  value: String(d.absoluteSessionTimeoutHours) });
  if (d.maxConcurrentSessions !== undefined)
    updates.push({ key: "MAX_CONCURRENT_SESSIONS",         value: String(d.maxConcurrentSessions) });
  if (d.passwordMinLength !== undefined)
    updates.push({ key: "PASSWORD_MIN_LENGTH",             value: String(d.passwordMinLength) });
  if (d.passwordMinClasses !== undefined)
    updates.push({ key: "PASSWORD_MIN_CLASSES",            value: String(d.passwordMinClasses) });
  if (d.passwordCustomDictionary !== undefined)
    updates.push({ key: "PASSWORD_CUSTOM_DICTIONARY",      value: d.passwordCustomDictionary });
  if (d.passwordExpiryDays !== undefined)
    updates.push({ key: "PASSWORD_EXPIRY_DAYS",            value: String(d.passwordExpiryDays) });
  if (d.passwordMinAgeHours !== undefined)
    updates.push({ key: "PASSWORD_MIN_AGE_HOURS",          value: String(d.passwordMinAgeHours) });
  if (d.passwordHistoryCount !== undefined)
    updates.push({ key: "PASSWORD_HISTORY_COUNT",          value: String(d.passwordHistoryCount) });

  await Promise.all(
    updates.map(({ key, value }) =>
      prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  );

  return NextResponse.json(await getSettings());
});
