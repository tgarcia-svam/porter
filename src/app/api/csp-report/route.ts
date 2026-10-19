import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

/**
 * Receives Content-Security-Policy violation reports (CSP `report-uri` and the
 * Reporting API `report-to` group). Unauthenticated by necessity — browsers send
 * these without cookies' CSRF header — so it is rate-limited in middleware, caps
 * the body size, never echoes input, and logs only a sanitized, truncated summary.
 */

const MAX_BYTES = 16 * 1024;

type Json = Record<string, unknown>;

function str(v: unknown, max = 200): string | undefined {
  return typeof v === "string" ? v.slice(0, max) : undefined;
}

// Keep only origin/path of a URL — drop query strings and fragments (may hold tokens/PII).
function stripUrl(v: unknown): string | undefined {
  const s = str(v, 500);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return `${u.origin}${u.pathname}`.slice(0, 200);
  } catch {
    return s.slice(0, 60); // e.g. "inline", "eval", "data"
  }
}

function summarize(raw: unknown): Json | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Json;
  // Legacy report-uri: { "csp-report": { ... } }
  // Reporting API:     { type: "csp-violation", body: { ... } } (inside an array)
  const r = (o["csp-report"] ?? o["body"] ?? o) as Json;
  if (!r || typeof r !== "object") return null;
  return {
    directive: str(r["violated-directive"] ?? r["effectiveDirective"] ?? r["effective-directive"], 80),
    blocked: stripUrl(r["blocked-uri"] ?? r["blockedURL"] ?? r["blockedURI"]),
    document: stripUrl(r["document-uri"] ?? r["documentURL"] ?? r["documentURI"]),
    disposition: str(r["disposition"], 20),
  };
}

export async function POST(req: NextRequest) {
  try {
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) return new NextResponse(null, { status: 413 });

    const text = await req.text();
    if (text.length > MAX_BYTES) return new NextResponse(null, { status: 413 });

    const parsed: unknown = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed.slice(0, 5) : [parsed];
    for (const item of items) {
      const s = summarize(item);
      if (s) logger.warn("CSP violation report", s);
    }
  } catch {
    // Malformed report: ignore — never surface parser errors to the sender.
  }
  return new NextResponse(null, { status: 204 });
}
