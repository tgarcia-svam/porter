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
  if (!cookieToken || !headerToken || cookieToken.length !== 64 || headerToken.length !== 64) {
    return false;
  }
  // XOR every character position so the loop always runs to completion —
  // `===` can short-circuit on the first differing byte, enabling timing attacks.
  // Node crypto.timingSafeEqual is unavailable in the Edge runtime used by middleware.
  let diff = 0;
  for (let i = 0; i < 64; i++) {
    diff |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i);
  }
  return diff === 0;
}
