import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * App-level encryption for sensitive fields such as gate and lockbox codes
 * (SPEC §5.1, §13.1). AES-256-GCM with a random 96-bit IV per value; the key is
 * FIELD_ENCRYPTION_KEY (32 bytes, base64), never stored in the database.
 *
 * Format (matches the property_secrets check constraint):
 *   v1:<iv base64url>:<auth tag base64url>:<ciphertext base64url>
 */

const VERSION = "v1";

export class FieldEncryptionError extends Error {}

function keyFrom(base64Key: string | undefined): Buffer {
  if (!base64Key) throw new FieldEncryptionError("FIELD_ENCRYPTION_KEY is not set.");
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32)
    throw new FieldEncryptionError("FIELD_ENCRYPTION_KEY must be 32 bytes (base64).");
  return key;
}

export function encryptField(plaintext: string, base64Key: string | undefined): string {
  const key = keyFrom(base64Key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    data.toString("base64url"),
  ].join(":");
}

export function decryptField(payload: string, base64Key: string | undefined): string {
  const key = keyFrom(base64Key);
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== VERSION || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new FieldEncryptionError("Unrecognized encrypted value.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new FieldEncryptionError(
      "The value could not be decrypted (wrong key or tampered data).",
    );
  }
}
