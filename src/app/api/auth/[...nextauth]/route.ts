import type { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { withSessionCookieExpiryStripped } from "@/lib/strip-session-cookie-expiry";

// The session JWT still expires server-side after 30 minutes; only the cookie's
// Expires/Max-Age is removed so it is not written to disk (see strip-session-cookie-expiry).
export async function GET(req: NextRequest) {
  return withSessionCookieExpiryStripped(await handlers.GET(req));
}

export async function POST(req: NextRequest) {
  return withSessionCookieExpiryStripped(await handlers.POST(req));
}
