import { BANNED_PASSWORD_BASES, BANNED_PASSWORD_EXACT } from "./banned-passwords";

/**
 * Password policy (shared by the set-password UI and the server-side reset route):
 *   - minimum 15 characters
 *   - at least 3 of 4 character classes: upper, lower, digit, special
 *   - not a common/banned password (exact or dominant base)
 *   - must not contain the email local-part (the username)
 *
 * checkPassword() returns the individual rule outcomes so the UI can render a live
 * checklist; validatePassword() collapses that into a pass/fail + error messages
 * for server enforcement. The server is always authoritative.
 */

export const MIN_PASSWORD_LENGTH = 15;
export const MIN_CHARACTER_CLASSES = 3;

// Allowed special characters per the requirement:  !"#$%&'()+,-./:;=?@[\]^_`{|}~
const SPECIAL_RE = /[!"#$%&'()+,\-./:;=?@[\\\]^_`{|}~]/;

export type PasswordChecks = {
  length: boolean;
  classes: boolean;       // ≥3 of 4 classes
  notCommon: boolean;
  notUsername: boolean;
  classCount: number;
};

function classCount(pw: string): number {
  let n = 0;
  if (/[A-Z]/.test(pw)) n++;
  if (/[a-z]/.test(pw)) n++;
  if (/[0-9]/.test(pw)) n++;
  if (SPECIAL_RE.test(pw)) n++;
  return n;
}

/** True when the password is a common/banned password or trivially structured. */
function isCommonPassword(pw: string): boolean {
  const lower = pw.toLowerCase();

  if (BANNED_PASSWORD_EXACT.has(lower)) return true;

  // A single repeated character (e.g. "aaaaaaaaaaaaaaa").
  if (/^(.)\1+$/.test(pw)) return true;

  // Strip to letters only and to digits only — catch a weak base padded with the
  // other class to reach length (e.g. "Password1234567", "letmein99999999").
  const letters = lower.replace(/[^a-z]/g, "");
  const digits = lower.replace(/[^0-9]/g, "");

  for (const base of BANNED_PASSWORD_BASES) {
    if (!base) continue;
    if (lower.includes(base)) return true;
    // Letter-only base (e.g. "password") forming the bulk of the letters.
    if (/^[a-z]+$/.test(base) && letters.includes(base) && letters.length <= base.length + 2) {
      return true;
    }
  }

  // Long monotonic digit runs / simple ascending or descending sequences.
  if (/^\d+$/.test(digits) && digits.length >= 10 && isSequential(digits)) return true;

  return false;
}

function isSequential(s: string): boolean {
  let asc = true;
  let desc = true;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (d !== 1) asc = false;
    if (d !== -1) desc = false;
  }
  return asc || desc;
}

export function checkPassword(password: string, email?: string): PasswordChecks {
  const localPart = (email ?? "").split("@")[0]?.toLowerCase() ?? "";
  const cc = classCount(password);
  return {
    length: password.length >= MIN_PASSWORD_LENGTH,
    classes: cc >= MIN_CHARACTER_CLASSES,
    classCount: cc,
    notCommon: !isCommonPassword(password),
    notUsername: localPart.length < 3 || !password.toLowerCase().includes(localPart),
  };
}

export function validatePassword(
  password: string,
  email?: string
): { ok: boolean; errors: string[] } {
  const c = checkPassword(password, email);
  const errors: string[] = [];
  if (!c.length) errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (!c.classes)
    errors.push(
      `Password must include at least ${MIN_CHARACTER_CLASSES} of: uppercase, lowercase, number, special character.`
    );
  if (!c.notCommon) errors.push("Password is too common or easily guessed. Choose something unique.");
  if (!c.notUsername) errors.push("Password must not contain your email/username.");
  return { ok: errors.length === 0, errors };
}
