import crypto from "crypto";

/**
 * Short-lived, HMAC-signed "login ticket". The /api/account/login route performs
 * all credential + MFA + lockout checks (where we fully control the responses) and,
 * only on full success, issues a ticket. NextAuth's Credentials authorize() then
 * trusts a valid, unexpired ticket instead of re-implementing password/MFA logic.
 *
 * The ticket is signed with NEXTAUTH_SECRET (no DB round-trip) and bound to the
 * email + a 60s expiry, so it can't be forged and is useless after the immediate
 * exchange. HTTPS prevents capture; the tiny window bounds any replay.
 */

const TICKET_TTL_MS = 60 * 1000;

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set — cannot sign login tickets");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function issueLoginTicket(email: string): string {
  const exp = Date.now() + TICKET_TTL_MS;
  const payload = `${Buffer.from(email.toLowerCase()).toString("base64url")}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the verified email if the ticket is authentic and unexpired, else null. */
export function verifyLoginTicket(ticket: string): string | null {
  if (!ticket) return null;
  const parts = ticket.split(".");
  if (parts.length !== 3) return null;
  const [emailB64, expStr, sig] = parts;
  const payload = `${emailB64}.${expStr}`;

  const expected = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;

  try {
    return Buffer.from(emailB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
}
