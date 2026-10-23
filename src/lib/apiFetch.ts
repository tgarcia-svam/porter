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

// ── Destination allowlist ─────────────────────────────────────────────────────
// Requests may only go to an allow-listed protocol + host + port, supplied by the deployment
// as NEXT_PUBLIC_APP_ORIGINS (comma-separated origins, set at build time from the environment's
// public URL). Plain http is accepted for localhost only.

interface AllowedOrigin {
  origin: string;
  protocol: string;
  hostname: string;
  port: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function effectivePort(u: { protocol: string; port: string }): string {
  return u.port || (u.protocol === "https:" ? "443" : "80");
}

function sameDestination(a: AllowedOrigin | URL | Location, b: AllowedOrigin | URL | Location): boolean {
  return (
    a.protocol === b.protocol &&
    a.hostname === b.hostname &&
    effectivePort(a) === effectivePort(b)
  );
}

function allowedOrigins(): AllowedOrigin[] {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGINS;
  const raw = configured || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  const list: AllowedOrigin[] = [];
  for (const item of raw.split(",")) {
    const text = item.trim();
    if (!text) continue;
    let u: URL;
    try {
      u = new URL(text);
    } catch {
      continue;
    }
    const secure = u.protocol === "https:";
    if (!secure && !(u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname))) continue;
    list.push({ origin: u.origin, protocol: u.protocol, hostname: u.hostname, port: effectivePort(u) });
  }
  if (list.length === 0) throw new Error("apiFetch: NEXT_PUBLIC_APP_ORIGINS is not configured");
  return list;
}

// Path: "/api" followed by segments of letters, digits, "_" and "-" only (route names and
// record IDs). No dots, percent-escapes, colons, "@", etc.
const API_PATH = /^\/api(?:\/[A-Za-z0-9_-]+)+$/;
const QUERY_KEY = /^[A-Za-z0-9_]+$/;

/**
 * Build the absolute request URL from the allow-listed origin (never from the input), a
 * strictly validated path and a query string rebuilt with encodeURIComponent, then
 * re-validate the end result against the allowlist.
 */
function buildTarget(input: string): string {
  const q = input.indexOf("?");
  const pathname = q === -1 ? input : input.slice(0, q);
  const rawQuery = q === -1 ? "" : input.slice(q + 1);
  if (!API_PATH.test(pathname)) throw new Error("apiFetch: only /api/ paths are allowed");

  const pairs: string[] = [];
  if (rawQuery) {
    for (const [key, value] of new URLSearchParams(rawQuery)) {
      if (!QUERY_KEY.test(key)) throw new Error("apiFetch: invalid query parameter");
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }

  const allowed = allowedOrigins();
  const entry = allowed.find((o) => sameDestination(o, window.location));
  if (!entry) throw new Error("apiFetch: this host is not an allowed API origin");

  const target = new URL(pathname, entry.origin);
  target.search = pairs.join("&");
  if (!allowed.some((o) => sameDestination(o, target)) || !target.pathname.startsWith("/api/")) {
    throw new Error("apiFetch: destination is not allowed");
  }
  return target.href;
}

/** True only for an allow-listed protocol + host + port whose path is under /api/. */
function isAllowedApiUrl(url: URL): boolean {
  return allowedOrigins().some((o) => sameDestination(o, url)) && url.pathname.startsWith("/api/");
}

/**
 * Drop-in replacement for fetch() that automatically injects the CSRF token
 * header on state-changing requests (POST, PUT, DELETE, PATCH) and redirects
 * to the login page on 401 (expired session / UA mismatch). A CSRF rejection
 * (session rotated since the token was cached) refreshes the token and retries once.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const safeUrl = new URL(buildTarget(path));
  if (!isAllowedApiUrl(safeUrl)) throw new Error("apiFetch: destination is not allowed");

  const method = (init?.method ?? "GET").toUpperCase();
  const mutating = ["POST", "PUT", "DELETE", "PATCH"].includes(method);

  // Single validated network sink shared by every request below.
  const send = (opts?: RequestInit) => fetch(safeUrl.href, opts);

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
