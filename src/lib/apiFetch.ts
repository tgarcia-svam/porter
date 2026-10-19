import { signOut } from "next-auth/react";

const CSRF_HEADER = "x-csrf-token";

// The csrf-token cookie is HttpOnly, so the token is fetched from GET /api/csrf
// (HMAC-signed, bound to the current session) and cached in memory.
let cachedToken: string | null = null;
let inflight: Promise<string> | null = null;

async function loadCsrfToken(force = false): Promise<string> {
  if (!force && cachedToken) return cachedToken;
  if (!inflight) {
    inflight = fetch("/api/csrf", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("csrf token unavailable");
        const body = (await r.json()) as { token?: string };
        if (!body.token) throw new Error("csrf token unavailable");
        cachedToken = body.token;
        return body.token;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Test helper: forget the cached token. */
export function resetCsrfCache(): void {
  cachedToken = null;
  inflight = null;
}

// 401 means the session has expired or the session binding check failed.
// 403s are intentionally excluded: domain 403s ("cannot delete your own account",
// "cannot remove last admin") must show their error message, not trigger a sign-out.
function handleAuthError(res: Response): Response {
  if (res.status === 401 && window.location.pathname !== "/login") {
    void signOut({ callbackUrl: "/login?reason=session_expired" });
  }
  return res;
}

async function isCsrfRejection(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try {
    return (await res.clone().text()).includes("Invalid CSRF token");
  } catch {
    return false;
  }
}

/**
 * Drop-in replacement for fetch() that automatically injects the CSRF token
 * header on state-changing requests (POST, PUT, DELETE, PATCH) and redirects
 * to the login page on 401 (expired session / UA mismatch). A CSRF rejection
 * (session rotated since the token was cached) refreshes the token and retries once.
 */
// Only same-origin API paths are allowed: a leading "/api/" followed by URL-safe characters.
// Rejects protocol-relative ("//host"), backslash, "@host" and control-character tricks.
const API_PATH = /^\/api\/[A-Za-z0-9._~\-/%?=&+,:@]*$/;

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!API_PATH.test(path)) throw new Error("apiFetch: only relative /api/ paths are allowed");
  // Parse against the actual deployed origin and assert the result stays on that origin
  // and does not escape /api/ after normalisation (e.g. /api/../x).
  const parsed = new URL(path, window.location.origin);
  if (parsed.origin !== window.location.origin) throw new Error("apiFetch: host override detected");
  if (!parsed.pathname.startsWith("/api/")) throw new Error("apiFetch: path escapes /api/");
  const safePath = parsed.pathname + parsed.search;

  const method = (init?.method ?? "GET").toUpperCase();
  const mutating = ["POST", "PUT", "DELETE", "PATCH"].includes(method);

  // Single validated network sink shared by every request below.
  const send = (opts?: RequestInit) => fetch(safePath, opts);

  if (!mutating) return send(init).then(handleAuthError);

  const sendWithToken = async (force: boolean) => {
    const headers = new Headers(init?.headers);
    headers.set(CSRF_HEADER, await loadCsrfToken(force));
    return send({ ...init, headers });
  };

  let res = await sendWithToken(false);
  if (await isCsrfRejection(res)) res = await sendWithToken(true);
  return handleAuthError(res);
}
