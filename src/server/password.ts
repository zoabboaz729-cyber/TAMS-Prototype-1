import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/**
 * Hashes a plain text password using Node.js built-in scrypt with a random salt.
 * Formatted as "scrypt$<salt>$<hash>".
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

/**
 * Verifies a plain text password against a stored hash using timing-safe comparison.
 * Expects the hash to be in "scrypt$<salt>$<hash>" format.
 */
export async function verifyPassword(
  plain: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const salt = parts[1];
  const storedHashHex = parts[2];
  if (!salt || !storedHashHex) {
    return false;
  }

  try {
    const derivedKey = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
    const storedKey = Buffer.from(storedHashHex, "hex");

    if (derivedKey.length !== storedKey.length) {
      return false;
    }

    return timingSafeEqual(derivedKey, storedKey);
  } catch {
    return false;
  }
}
