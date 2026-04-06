import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

type RequestCtx = {
  uaHash: string | null;
};

/**
 * Populated by the NextAuth handler wrappers so the jwt callback can read the
 * requesting client's User-Agent at sign-in time without requiring the Request
 * to be threaded through NextAuth callbacks.
 */
export const requestStore = new AsyncLocalStorage<RequestCtx>();

/** SHA-256 hash of a User-Agent string. Returns null for empty/missing UAs. */
export function hashUa(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return createHash("sha256").update(ua).digest("hex");
}

/**
 * Verify that the current request's User-Agent matches the hash bound to the
 * session at sign-in time.
 *
 * Returns true when:
 * - No binding was set (sessions created before this feature was deployed)
 * - The current UA hash matches the bound hash
 *
 * Returns false when the hashes differ, indicating the token is being used
 * from a different browser or device than the one that authenticated.
 */
export function verifySessionBinding(
  boundUaHash: string | null | undefined,
  req: Pick<Request, "headers">
): boolean {
  if (!boundUaHash) return true; // unbound session — allow through
  return hashUa(req.headers.get("user-agent")) === boundUaHash;
}
