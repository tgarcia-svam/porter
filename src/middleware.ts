import { NextRequest, NextResponse } from "next/server";

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

// ── Middleware ───────────────────────────────────────────────────────────────
export function middleware(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const path = req.nextUrl.pathname;
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
