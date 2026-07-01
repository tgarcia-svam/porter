/**
 * Banned / common-password screen. The 15-character minimum already excludes most
 * classic weak passwords ("password", "123456", …), but long-yet-weak strings
 * ("passwordpassword", "123456789012345", repeated keyboard runs) still need to be
 * rejected. This list holds common bases and weak long strings; the policy check
 * (password-policy.ts) tests for exact membership AND substring containment of a
 * base, plus structural checks (single repeated char, simple sequences).
 *
 * Kept intentionally small and curated rather than a multi-MB breach corpus —
 * the length + complexity + structural rules carry most of the weight, and a
 * giant in-memory list would bloat the serverless bundle.
 */
export const BANNED_PASSWORD_BASES: string[] = [
  "password",
  "passw0rd",
  "p@ssword",
  "p@ssw0rd",
  "letmein",
  "welcome",
  "admin",
  "administrator",
  "qwerty",
  "qwertyuiop",
  "asdfgh",
  "asdfghjkl",
  "zxcvbn",
  "zxcvbnm",
  "iloveyou",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "superman",
  "batman",
  "trustno1",
  "master",
  "shadow",
  "abc123",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "qazwsx",
  "qazwsxedc",
  "changeme",
  "default",
  "secret",
  "ncc1701",
  "starwars",
  "whatever",
  "porter",
  "porterdata",
];

// Fully-spelled common strings that on their own exceed/meet typical lengths and
// must be blocked even though they pass the character-class test.
export const BANNED_PASSWORD_EXACT: Set<string> = new Set([
  "passwordpassword",
  "password12345",
  "password123456",
  "passwordpassword1",
  "qwertyqwerty",
  "qwertyuiopasdfgh",
  "1234567890123456",
  "abcdefghijklmnop",
  "letmein123456789",
  "welcome123456789",
  "administrator123",
  "changemechangeme",
]);
