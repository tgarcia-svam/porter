import { generateSecret, generateURI, verify } from "otplib";

/**
 * TOTP (RFC 6238) helpers wrapping otplib for authenticator-app MFA. The shared
 * secret is generated here, shown to the user once as a QR code during enrollment,
 * and thereafter stored encrypted (see crypto-at-rest.ts). A ±30s epoch tolerance
 * (one step either side) absorbs minor client/server clock skew without
 * meaningfully weakening the second factor.
 */

const ISSUER = "Porter";
const EPOCH_TOLERANCE_SEC = 30;

export function generateTotpSecret(): string {
  return generateSecret(); // base32
}

/** otpauth:// URL encoded into the enrollment QR code. */
export function buildOtpAuthUrl(email: string, secret: string): string {
  return generateURI({ issuer: ISSUER, label: email, secret });
}

export async function verifyTotp(token: string, secret: string): Promise<boolean> {
  const cleaned = (token ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    const result = await verify({ secret, token: cleaned, epochTolerance: EPOCH_TOLERANCE_SEC });
    return result.valid;
  } catch {
    return false;
  }
}
