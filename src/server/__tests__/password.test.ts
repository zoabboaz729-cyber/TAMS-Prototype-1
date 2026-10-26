import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../password";

describe("Password Hashing & Verification (scrypt)", () => {
  it("verifies a correct password successfully", async () => {
    const plain = "DemoSecret123!";
    const hash = await hashPassword(plain);

    expect(hash.startsWith("scrypt$")).toBe(true);
    const verified = await verifyPassword(plain, hash);
    expect(verified).toBe(true);
  });

  it("fails verification with an incorrect password", async () => {
    const plain = "CorrectPassword123";
    const hash = await hashPassword(plain);

    const verified = await verifyPassword("WrongPassword456", hash);
    expect(verified).toBe(false);
  });

  it("produces distinct hashes for the same password due to random salt", async () => {
    const plain = "SamePasswordAcrossUsers";
    const hash1 = await hashPassword(plain);
    const hash2 = await hashPassword(plain);

    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword(plain, hash1)).toBe(true);
    expect(await verifyPassword(plain, hash2)).toBe(true);
  });

  it("returns false gracefully on malformed hash strings", async () => {
    expect(await verifyPassword("test", "")).toBe(false);
    expect(await verifyPassword("test", "invalid-hash")).toBe(false);
    expect(await verifyPassword("test", "bcrypt$salt$hash")).toBe(false);
    expect(await verifyPassword("test", "scrypt$onlyonepart")).toBe(false);
  });
});
