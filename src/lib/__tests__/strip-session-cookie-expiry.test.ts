import { describe, it, expect } from "vitest";
import {
  stripSessionCookieExpiry,
  withSessionCookieExpiryStripped,
} from "../strip-session-cookie-expiry";

const future = new Date(Date.now() + 30 * 60_000).toUTCString();
const SESSION = `__Secure-authjs.session-token=abc.def; Path=/; Expires=${future}; HttpOnly; Secure; SameSite=Strict`;
const PKCE = `__Secure-authjs.pkce.code_verifier=xyz; Path=/; Expires=${future}; HttpOnly; Secure; SameSite=Lax`;
const CALLBACK = "__Secure-authjs.callback-url=https%3A%2F%2Fexample.test; Path=/; HttpOnly; Secure; SameSite=Lax";

describe("stripSessionCookieExpiry", () => {
  it("removes Expires from the session token and keeps other attributes", () => {
    expect(stripSessionCookieExpiry(SESSION)).toBe(
      "__Secure-authjs.session-token=abc.def; Path=/; HttpOnly; Secure; SameSite=Strict"
    );
  });
  it("removes Max-Age too and handles chunk suffixes and dev names", () => {
    expect(stripSessionCookieExpiry("authjs.session-token.1=v; Max-Age=1800; Path=/")).toBe(
      "authjs.session-token.1=v; Path=/"
    );
  });
  it("leaves other cookies untouched", () => {
    expect(stripSessionCookieExpiry(PKCE)).toBe(PKCE);
    expect(stripSessionCookieExpiry(CALLBACK)).toBe(CALLBACK);
  });
  it("keeps Expires on deletion cookies so they still clear", () => {
    const del = "__Secure-authjs.session-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly";
    expect(stripSessionCookieExpiry(del)).toBe(del);
    const del2 = "__Secure-authjs.session-token=zzz; Path=/; Max-Age=0";
    expect(stripSessionCookieExpiry(del2)).toBe(del2);
  });
});

describe("withSessionCookieExpiryStripped", () => {
  it("preserves every Set-Cookie header and only rewrites the session cookie", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", PKCE);
    headers.append("set-cookie", SESSION);
    headers.append("set-cookie", `__Secure-authjs.session-token.1=part2; Path=/; Expires=${future}; HttpOnly`);
    headers.append("set-cookie", CALLBACK);
    const res = withSessionCookieExpiryStripped(new Response('{"ok":true}', { status: 200, headers }));
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(4);
    expect(cookies[0]).toBe(PKCE);
    expect(cookies[1]).not.toMatch(/expires/i);
    expect(cookies[2]).not.toMatch(/expires/i);
    expect(cookies[3]).toBe(CALLBACK);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe('{"ok":true}');
  });
  it("returns the original response when there is no session cookie", () => {
    const res = new Response("x", { headers: { "set-cookie": PKCE } });
    expect(withSessionCookieExpiryStripped(res)).toBe(res);
  });
  it("preserves redirects (status + location)", () => {
    const headers = new Headers({ location: "https://example.test/" });
    headers.append("set-cookie", SESSION);
    const res = withSessionCookieExpiryStripped(new Response(null, { status: 302, headers }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.test/");
  });
});
