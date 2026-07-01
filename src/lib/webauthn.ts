import crypto from "crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

/**
 * WebAuthn/passkey helpers wrapping @simplewebauthn/server. Passkeys are an
 * alternative MFA second factor to TOTP for PASSWORD accounts: the private key
 * stays on the user's device; we persist only the public key + signature counter
 * (see the Passkey model). The Relying Party ID / origin are derived from
 * NEXTAUTH_URL, so this works unchanged across localhost and the deployed host.
 *
 * Challenges are short-lived and single-use. We keep them in a signed, httpOnly
 * cookie (HMAC over NEXTAUTH_SECRET) rather than the DB — stateless and correct
 * across multiple app instances.
 */

// Derive option/response types from the library functions so we don't depend on
// internal type-export names (which vary between versions).
type RegVerifyOpts = Parameters<typeof verifyRegistrationResponse>[0];
type AuthVerifyOpts = Parameters<typeof verifyAuthenticationResponse>[0];
export type RegistrationResponse = RegVerifyOpts["response"];
export type AuthenticationResponse = AuthVerifyOpts["response"];
type AuthGenOpts = NonNullable<Parameters<typeof generateAuthenticationOptions>[0]>;
type Descriptor = NonNullable<AuthGenOpts["allowCredentials"]>[number];
type Transports = Descriptor["transports"];

export type StoredCredential = {
  credentialId: string; // base64url
  transports: string[];
};

function rp(): { rpID: string; rpName: string; origin: string } {
  const url = new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000");
  return { rpID: url.hostname, rpName: "Porter", origin: url.origin };
}

function toDescriptor(c: StoredCredential): Descriptor {
  return {
    id: isoBase64URL.toBuffer(c.credentialId),
    type: "public-key",
    transports: c.transports as Transports,
  };
}

// ── Registration (enrollment) ──────────────────────────────────────────────────

export function buildRegistrationOptions(
  userId: string,
  email: string,
  existing: StoredCredential[]
) {
  const { rpID, rpName } = rp();
  return generateRegistrationOptions({
    rpName,
    rpID,
    userID: userId,
    userName: email,
    attestationType: "none",
    excludeCredentials: existing.map(toDescriptor),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
}

export async function verifyRegistration(
  response: RegistrationResponse,
  expectedChallenge: string
) {
  const { rpID, origin } = rp();
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  if (!result.verified || !result.registrationInfo) return null;
  const info = result.registrationInfo;
  return {
    credentialId: isoBase64URL.fromBuffer(info.credentialID),
    publicKey: Buffer.from(info.credentialPublicKey),
    counter: info.counter,
    // response.response.transports is present on modern browsers.
    transports: (response.response?.transports ?? []) as string[],
  };
}

// ── Authentication (login second factor) ────────────────────────────────────────

export function buildAuthenticationOptions(creds: StoredCredential[]) {
  const { rpID } = rp();
  return generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map(toDescriptor),
    userVerification: "preferred",
  });
}

export async function verifyAuthentication(
  response: AuthenticationResponse,
  expectedChallenge: string,
  authenticator: { credentialId: string; publicKey: Uint8Array; counter: number; transports: string[] }
): Promise<{ verified: boolean; newCounter: number }> {
  const { rpID, origin } = rp();
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    authenticator: {
      credentialID: isoBase64URL.toBuffer(authenticator.credentialId),
      credentialPublicKey: authenticator.publicKey,
      counter: authenticator.counter,
      transports: authenticator.transports as Transports,
    },
    requireUserVerification: false,
  });
  return { verified: result.verified, newCounter: result.authenticationInfo?.newCounter ?? authenticator.counter };
}

// ── Signed challenge cookie ──────────────────────────────────────────────────────

export const CHALLENGE_COOKIE = "pk-challenge";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set — cannot sign WebAuthn challenges");
  return s;
}

/** Sign {scope, email, challenge, exp} into an opaque cookie value. */
export function signChallenge(scope: "reg" | "auth", email: string, challenge: string): string {
  const exp = Date.now() + CHALLENGE_TTL_MS;
  const payload = `${scope}.${Buffer.from(email.toLowerCase()).toString("base64url")}.${challenge}.${exp}`;
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/** Return the challenge if the cookie is authentic, unexpired, and scope/email match. */
export function readChallenge(
  cookieValue: string | undefined,
  scope: "reg" | "auth",
  email: string
): string | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 5) return null;
  const [scopePart, emailB64, challenge, expStr, sig] = parts;
  const payload = `${scopePart}.${emailB64}.${challenge}.${expStr}`;
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (scopePart !== scope) return null;
  if (Date.now() > Number(expStr)) return null;
  let email2 = "";
  try { email2 = Buffer.from(emailB64, "base64url").toString("utf8"); } catch { return null; }
  if (email2.toLowerCase() !== email.toLowerCase()) return null;
  return challenge;
}
