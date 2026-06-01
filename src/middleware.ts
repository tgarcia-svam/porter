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
  // ── Canonical host ─────────────────────────────────────────────────────────
  // NextAuth's OAuth cookies (pkce code_verifier, state) are host-only — bound
  // to the exact hostname that set them. If sign-in starts on www.<domain> but
  // the callback lands on the apex <domain> (both are registered redirect URIs),
  // the pkce cookie set on www is never sent to apex and login fails with
  // "pkceCodeVerifier cookie was missing", succeeding only on a retry once the
  // browser is on the apex host. NEXTAUTH_URL is the apex (https://porterdata.com),
  // so redirect www.* → apex (308) here, before any sign-in, to keep the whole
  // OAuth flow on a single host. Runs on the initial page load; the 308 is
  // cached so the browser won't return to www.
  const host = req.headers.get("host") ?? "";
  if (host.startsWith("www.")) {
    const url = req.nextUrl.clone();
    url.host = host.slice(4); // strip "www."
    return NextResponse.redirect(url, 308);
  }

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
  // NOTE: NextAuth routes (/api/auth/*) are excluded from the matcher entirely,
  // so the middleware never runs on them. This is deliberate: NextAuth emits
  // multiple Set-Cookie headers (pkce code_verifier, state, nonce, session
  // token) on its OAuth redirects, and a middleware that runs on those routes —
  // even just returning NextResponse.next() — can drop those Set-Cookie headers
  // in a production standalone build. A dropped pkce cookie surfaces at the
  // callback as "pkceCodeVerifier value could not be parsed". The isAuthRoute
  // guard below is belt-and-suspenders in case the matcher is ever loosened.
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
  // Run on API routes (rate limit + CSRF validation) and page navigations (to
  // seed the CSRF cookie), but NEVER on /api/auth/* — NextAuth manages its own
  // cookies there and middleware running on those routes can drop the OAuth
  // Set-Cookie headers (pkce/state/nonce) in production, breaking sign-in.
  // Also excludes Next.js internals and static assets.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
