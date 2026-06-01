import { NextRequest, NextResponse } from "next/server";
import { CSRF_COOKIE, generateCsrfToken, validateCsrf } from "@/lib/csrf";

// ── Rate limit config ────────────────────────────────────────────────────────
// Auth endpoints get a tighter limit to slow credential-stuffing attempts.
// General API endpoints get a generous limit for normal use.
const LIMITS: { prefix: string; max: number; windowMs: number }[] = [
  { prefix: "/api/auth",   max: 20,  windowMs: 60_000 }, // 20 req/min per IP
  { prefix: "/api/upload", max: 10,  windowMs: 60_000 }, // 10 req/min per IP
  { prefix: "/api/",       max: 120, windowMs: 60_000 }, // 120 req/min per IP
];

// ── In-memory store ──────────────────────────────────────────────────────────
// Works on Azure App Service (persistent process). For multi-instance deployments
// replace with a Redis-backed store.
type Window = { count: number; resetAt: number };
const store = new Map<string, Window>();

// Prune expired entries every 5 minutes to bound memory usage
setInterval(() => {
  const now = Date.now();
  for (const [key, win] of store) {
    if (now > win.resetAt) store.delete(key);
  }
}, 5 * 60_000);

function isAllowed(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const win = store.get(key);

  if (!win || now > win.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (win.count >= max) return false;
  win.count++;
  return true;
}

const MUTATION_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

// Paths exempt from CSRF validation — NextAuth handles its own CSRF internally,
// and the upload endpoint uses multipart/form-data which cannot set custom headers
// from a cross-origin form, so the same-origin session check is sufficient there.
const CSRF_EXEMPT = [
  "/api/auth",
  "/api/upload/process", // authenticated by X-Worker-Secret header, not session/CSRF
  "/api/upload/sas",     // session-authenticated JSON POST — no cookie available from SAS flow
  "/api/upload/confirm", // follows SAS upload — session-authenticated JSON POST
];

// ── Middleware ───────────────────────────────────────────────────────────────
export function middleware(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api");

  // Rate limiting and CSRF validation only apply to API routes. The middleware
  // also runs on page navigations (see matcher) solely to seed the CSRF cookie.
  if (isApi) {
    const rule = LIMITS.find((r) => path.startsWith(r.prefix));

    if (rule && !isAllowed(`${ip}:${rule.prefix}`, rule.max, rule.windowMs)) {
      return new NextResponse("Too Many Requests", {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rule.windowMs / 1000)),
          "Content-Type": "text/plain",
        },
      });
    }

    // ── CSRF validation ──────────────────────────────────────────────────────
    const isExempt = CSRF_EXEMPT.some((prefix) => path.startsWith(prefix));
    if (MUTATION_METHODS.has(req.method) && !isExempt && !validateCsrf(req)) {
      return new NextResponse("Invalid CSRF token", {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      });
    }
  }

  // ── Ensure CSRF cookie is set ──────────────────────────────────────────────
  // Seed the cookie on page navigations (and non-auth API requests) so it's
  // present in the browser before any client-side mutation. The client reads
  // it from document.cookie to send the X-CSRF-Token header.
  //
  // Skip NextAuth routes. They emit their own Set-Cookie headers (pkce
  // code_verifier, state, nonce, session token); writing a cookie on this
  // response races with those headers and drops them. Because we only set the
  // cookie when it's absent — i.e. the very first request from a fresh browser
  // — this manifested as the OAuth callback failing on the *first* sign-in
  // attempt ("pkceCodeVerifier value could not be parsed") and succeeding on
  // retry once the cookie existed.
  const res = NextResponse.next();
  const isAuthRoute = path.startsWith("/api/auth");
  if (!isAuthRoute && !req.cookies.get(CSRF_COOKIE)) {
    res.cookies.set(CSRF_COOKIE, generateCsrfToken(), {
      httpOnly: false, // must be readable by client JS
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }
  return res;
}

export const config = {
  // Run on API routes (rate limit + CSRF validation) and on page navigations
  // (to seed the CSRF cookie), excluding Next.js internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
