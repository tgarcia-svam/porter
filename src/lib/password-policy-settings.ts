import { prismaAdmin as prisma } from "./prisma-admin";
import type { PolicyOverrides } from "./password-policy";

/**
 * Full admin-configurable password policy, read from AppSetting.
 * PolicyOverrides covers the fields needed for per-character validation.
 * The remaining fields (minAgeHours, historyCount, expiryDays) are
 * enforced at the route level, not inside checkPassword/validatePassword.
 */
export type FullPolicySettings = PolicyOverrides & {
  minLength:        number;
  minClasses:       number;
  customDictionary: string[];
  minAgeHours:      number;
  historyCount:     number;
  expiryDays:       number;
};

const POLICY_KEYS = [
  "PASSWORD_MIN_LENGTH",
  "PASSWORD_MIN_CLASSES",
  "PASSWORD_MIN_AGE_HOURS",
  "PASSWORD_HISTORY_COUNT",
  "PASSWORD_CUSTOM_DICTIONARY",
  "PASSWORD_EXPIRY_DAYS",
] as const;

function parseList(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function getPasswordPolicySettings(): Promise<FullPolicySettings> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [...POLICY_KEYS] } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const minLength  = Math.max(1,  parseInt(map["PASSWORD_MIN_LENGTH"]   ?? "15"));
  const minClasses = Math.min(4, Math.max(1, parseInt(map["PASSWORD_MIN_CLASSES"]  ?? "3")));

  return {
    minLength,
    minClasses,
    customDictionary: parseList(map["PASSWORD_CUSTOM_DICTIONARY"] ?? ""),
    minAgeHours:  Math.max(0, parseInt(map["PASSWORD_MIN_AGE_HOURS"]  ?? "0")),
    historyCount: Math.max(0, parseInt(map["PASSWORD_HISTORY_COUNT"]  ?? "0")),
    expiryDays:   Math.max(0, parseInt(map["PASSWORD_EXPIRY_DAYS"]    ?? "0")),
  };
}
