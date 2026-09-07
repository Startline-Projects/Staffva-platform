import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * MFA backup-code primitives, shared by the generate route (aal2-only) and
 * the recovery route (reachable at aal1 — being locked out is its point).
 * Only salted scrypt digests ever reach the database.
 *
 * scrypt, not sha256: an 8-char code over a 31-symbol alphabet is ~39.6 bits
 * — a leaked table of fast unsalted hashes would fall to one GPU in about a
 * minute, every user at once. Salted scrypt (N=2^14) makes each guess cost
 * real work and each code cost it separately. Verification compares against
 * at most BACKUP_CODE_COUNT stored digests under a 5/hour rate limit, so the
 * cost lands on attackers, not users.
 */

// No 0/O/1/I/L — these codes get read off paper.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const BACKUP_CODE_COUNT = 10;

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 32;

function normalize(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** salt$digest, both hex — the format stored in mfa_backup_codes.code_hash. */
export function hashBackupCode(raw: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(normalize(raw), salt, SCRYPT_KEYLEN, { N: SCRYPT_N });
  return `${salt.toString("hex")}$${digest.toString("hex")}`;
}

export function verifyBackupCode(raw: string, stored: string): boolean {
  const [saltHex, digestHex] = stored.split("$");
  if (!saltHex || !digestHex) return false;
  const expected = Buffer.from(digestHex, "hex");
  const actual = scryptSync(normalize(raw), Buffer.from(saltHex, "hex"), expected.length, {
    N: SCRYPT_N,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generateBackupCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
    if (i === 3) out += "-";
  }
  return out;
}
