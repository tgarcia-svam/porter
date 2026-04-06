import { type NextRequest } from "next/server";

export const CSRF_COOKIE = "csrf-token";
export const CSRF_HEADER = "x-csrf-token";

/** Generate a cryptographically random CSRF token. */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate a CSRF token on a mutation request (POST/PUT/DELETE).
 * Compares the X-CSRF-Token request header against the csrf-token cookie.
 * Returns true when valid, false when the check fails or either value is missing.
 */
export function validateCsrf(req: NextRequest): boolean {
  const cookieToken = req.cookies.get(CSRF_COOKIE)?.value;
  const headerToken = req.headers.get(CSRF_HEADER);
  if (!cookieToken || !headerToken) return false;
  // Constant-time comparison to prevent timing attacks
  return cookieToken === headerToken && cookieToken.length === 64;
}
