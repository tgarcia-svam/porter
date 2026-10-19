import { type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Signed, session-bound double-submit CSRF protection.
 *
 * - The `csrf-token` cookie is HttpOnly and holds a random nonce N (never read by JS).
 * - The client obtains the request token T from `GET /api/csrf` and echoes it in the
 *   `x-csrf-token` header on mutations.
 * - T = HMAC-SHA256(NEXTAUTH_SECRET, "porter-csrf-v1|" + N + "|" + B), where B is the
 *   Auth.js JWT `sessionNonce` (stable per login) or "anon" when signed out. A token is
 *   therefore useless in another browser, another login, or after logout.
 *
 * Edge-runtime safe (WebCrypto only), because middleware validates every mutation.
 */

export const CSRF_COOKIE = "csrf-token";
export const CSRF_HEADER = "x-csrf-token";

const DOMAIN = "porter-csrf-v1";

/** Generate a random 64-hex-char nonce (cookie value). */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function secret(): string | undefined {
  return process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
}

/** HMAC-SHA256(secret, "porter-csrf-v1|nonce|binding") as 64 hex chars. */
export async function computeCsrfToken(
  nonce: string,
  sessionBinding: string,
  key: string | undefined = secret()
): Promise<string | null> {
  if (!key || !nonce) return null;
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(`${DOMAIN}|${nonce}|${sessionBinding}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The session binding B for this request: the JWT sessionNonce, or "anon". */
export async function getSessionBinding(req: NextRequest): Promise<string> {
  const key = secret();
  if (!key) return "anon";
  try {
    const secure = process.env.NODE_ENV === "production";
    const token = await getToken({ req, secret: key, secureCookie: secure });
    const nonce = token?.["sessionNonce"];
    return typeof nonce === "string" && nonce ? nonce : "anon";
  } catch {
    return "anon";
  }
}

/** Compare two 64-char strings without short-circuiting. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== 64 || b.length !== 64) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Validate a mutation request: the x-csrf-token header must equal the token derived from
 * the HttpOnly cookie nonce and the caller's current session. Fails closed (false) when the
 * cookie, header, or signing secret is missing.
 */
export async function validateCsrf(
  req: NextRequest,
  sessionBinding?: string
): Promise<boolean> {
  const nonce = req.cookies.get(CSRF_COOKIE)?.value;
  const headerToken = req.headers.get(CSRF_HEADER);
  if (!nonce || !headerToken || nonce.length !== 64 || headerToken.length !== 64) return false;
  const binding = sessionBinding ?? (await getSessionBinding(req));
  const expected = await computeCsrfToken(nonce, binding);
  if (!expected) return false;
  return timingSafeEqualHex(expected, headerToken);
}
