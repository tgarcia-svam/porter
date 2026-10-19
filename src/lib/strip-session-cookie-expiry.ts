/**
 * Auth.js stamps `Expires`/`Max-Age` on the session-token cookie, which makes the browser
 * persist it to disk (AppScan: "Permanent cookie contains sensitive session information").
 * The 30-minute idle limit is enforced server-side by the JWT `maxAge`, so the cookie can
 * safely be a browser-session cookie. Only `*session-token` cookies (incl. chunked
 * `.0`/`.1`) are touched; every other Set-Cookie header is forwarded byte-for-byte.
 *
 * Deletion cookies (empty value / past expiry) keep their Expires so they still clear.
 */

const SESSION_COOKIE = /^(?:__Secure-|__Host-)?authjs\.session-token(?:\.\d+)?=/;

export function stripSessionCookieExpiry(setCookie: string): string {
  if (!SESSION_COOKIE.test(setCookie)) return setCookie;
  const [pair, ...attrs] = setCookie.split(/;\s*/);
  const value = pair.slice(pair.indexOf("=") + 1);
  if (value === "") return setCookie; // deletion
  const maxAge = attrs.find((a) => /^max-age=/i.test(a));
  if (maxAge && Number(maxAge.split("=")[1]) <= 0) return setCookie; // deletion
  const expires = attrs.find((a) => /^expires=/i.test(a));
  if (expires && Date.parse(expires.slice(expires.indexOf("=") + 1)) <= Date.now()) return setCookie; // deletion
  const kept = attrs.filter((a) => !/^(expires|max-age)=/i.test(a));
  return [pair, ...kept].join("; ");
}

export function withSessionCookieExpiryStripped(res: Response): Response {
  const cookies = res.headers.getSetCookie();
  if (!cookies.some((c) => SESSION_COOKIE.test(c))) return res;
  const headers = new Headers(res.headers);
  headers.delete("set-cookie");
  for (const c of cookies) headers.append("set-cookie", stripSessionCookieExpiry(c));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
