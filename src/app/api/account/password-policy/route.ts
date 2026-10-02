import { NextResponse } from "next/server";
import { withHandler } from "@/lib/api-error";
import { getPasswordPolicySettings } from "@/lib/password-policy-settings";

/**
 * Public endpoint — returns the current password complexity rules so that
 * client-side forms can show a live, policy-accurate checklist without
 * hard-coding the values.
 *
 * Only the complexity fields (minLength, minClasses, customDictionary) are
 * exposed. Operational fields (minAgeHours, historyCount, expiryDays) are
 * enforced server-side only and not surfaced here.
 */
export const GET = withHandler(async () => {
  const { minLength, minClasses, customDictionary } = await getPasswordPolicySettings();
  return NextResponse.json({ minLength, minClasses, customDictionary });
});
