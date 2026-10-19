import { NextRequest, NextResponse } from "next/server";
import {
  CSRF_COOKIE,
  computeCsrfToken,
  generateCsrfToken,
  getSessionBinding,
} from "@/lib/csrf";

/**
 * GET /api/csrf — hands the client the request token to echo in `x-csrf-token`.
 * The cookie nonce is HttpOnly, so JS can only obtain the (session-bound, HMAC-signed)
 * token through this same-origin endpoint. Responses are no-store (next.config headers).
 * Creates the cookie here if the browser doesn't have one yet (middleware skips this path).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let nonce = req.cookies.get(CSRF_COOKIE)?.value;
  const fresh = !nonce || nonce.length !== 64;
  if (fresh) nonce = generateCsrfToken();

  const token = await computeCsrfToken(nonce!, await getSessionBinding(req));
  if (!token) return NextResponse.json({ error: "CSRF unavailable" }, { status: 500 });

  const res = NextResponse.json({ token });
  if (fresh) {
    res.cookies.set(CSRF_COOKIE, nonce!, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }
  return res;
}
