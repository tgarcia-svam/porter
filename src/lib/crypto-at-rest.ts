import crypto from "crypto";

/**
 * Symmetric encryption for secrets that must be recoverable at rest — currently
 * the TOTP shared secret. Passwords are NOT encrypted with this; they are hashed
 * (one-way) via bcrypt in password-auth.ts. A TOTP secret has to be decryptable to
 * verify codes, so it is encrypted with AES-256-GCM under a key held only in Key
 * Vault (MFA_ENCRYPTION_KEY), never written to the database in clear.
 *
 * Wire format (all base64, joined by ':'):  iv : authTag : ciphertext
 * A leading "v1:" version tag allows future key rotation / algorithm changes.
 */

const VERSION = "v1";

function getKey(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("MFA_ENCRYPTION_KEY is not set — cannot encrypt/decrypt MFA secrets");
  }
  // Accept base64 (preferred) or hex; must decode to exactly 32 bytes for AES-256.
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }
  if (key.length !== 32) {
    throw new Error(
      `MFA_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}); generate with: openssl rand -base64 32`
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed encrypted secret");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const key = getKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}
