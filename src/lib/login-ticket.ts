import crypto from "crypto";

/**
 * HMAC-signed tickets used by the local sign-in flow (no DB round-trip). Two kinds:
 *
 *  - "pending" (5 min): issued by /api/account/login once the PASSWORD step passes
 *    but a second factor is still required. It authorizes the follow-up TOTP or
 *    passkey step WITHOUT re-sending the password.
 *  - "login" (60 s): issued once BOTH factors pass. NextAuth's Credentials
 *    authorize() trusts a valid "login" ticket and mints the session — it never
 *    sees the password or second factor.
 *
 * Both are signed with NEXTAUTH_SECRET and bound to the email + a kind tag, so a
 * pending ticket can't be replayed as a login ticket. HTTPS + the short TTLs bound
 * any replay window.
 */

type Kind = "pending" | "login";
const TTL_MS: Record<Kind, number> = { pending: 5 * 60 * 1000, login: 60 * 1000 };

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set — cannot sign login tickets");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

function issue(kind: Kind, email: string): string {
  const exp = Date.now() + TTL_MS[kind];
  const payload = `${kind}.${Buffer.from(email.toLowerCase()).toString("base64url")}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the verified email if the ticket is authentic, unexpired, and of `kind`. */
function verify(kind: Kind, ticket: string): string | null {
  if (!ticket) return null;
  const parts = ticket.split(".");
  if (parts.length !== 4) return null;
  const [kindPart, emailB64, expStr, sig] = parts;
  const payload = `${kindPart}.${emailB64}.${expStr}`;

  const expected = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  if (kindPart !== kind) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;

  try {
    return Buffer.from(emailB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export const issuePendingTicket = (email: string) => issue("pending", email);
export const verifyPendingTicket = (ticket: string) => verify("pending", ticket);
export const issueLoginTicket = (email: string) => issue("login", email);
export const verifyLoginTicket = (ticket: string) => verify("login", ticket);
