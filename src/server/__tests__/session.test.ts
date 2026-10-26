import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  createSessionToken,
  verifySessionToken,
  SESSION_DURATION_MS,
} from "@/server/session";

const SECRET_A = "secret-A-for-tams-testing-at-least-32-chars-long";
const SECRET_B = "secret-B-for-tams-testing-at-least-32-chars-long";

const NOW = 1_000_000_000_000; // a fixed epoch ms for deterministic tests
const PAYLOAD = {
  userId: "user-001",
  role: "LECTURER" as const,
  expiresAtMs: NOW + SESSION_DURATION_MS,
};

describe("Session tokens", () => {
  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------
  it("round-trips a valid token", () => {
    const token = createSessionToken(PAYLOAD, SECRET_A);
    const result = verifySessionToken(token, SECRET_A, NOW);
    expect(result).toEqual(PAYLOAD);
  });

  it("exports SESSION_DURATION_MS equal to 8 hours", () => {
    expect(SESSION_DURATION_MS).toBe(8 * 60 * 60 * 1000);
  });

  // -----------------------------------------------------------------------
  // Expiry
  // -----------------------------------------------------------------------
  it("rejects a token that has expired (nowMs > expiresAtMs)", () => {
    const token = createSessionToken(PAYLOAD, SECRET_A);
    const afterExpiry = PAYLOAD.expiresAtMs + 1;
    expect(verifySessionToken(token, SECRET_A, afterExpiry)).toBeNull();
  });

  it("rejects a token at exactly the expiry time (nowMs === expiresAtMs)", () => {
    const token = createSessionToken(PAYLOAD, SECRET_A);
    expect(verifySessionToken(token, SECRET_A, PAYLOAD.expiresAtMs)).toBeNull();
  });

  it("accepts a token one millisecond before expiry", () => {
    const token = createSessionToken(PAYLOAD, SECRET_A);
    const justBefore = PAYLOAD.expiresAtMs - 1;
    expect(verifySessionToken(token, SECRET_A, justBefore)).toEqual(PAYLOAD);
  });

  // -----------------------------------------------------------------------
  // Tampering — payload
  // -----------------------------------------------------------------------
  it("rejects a token whose payload role was changed to ADMIN (old sig kept)", () => {
    const token = createSessionToken(PAYLOAD, SECRET_A);
    const [payloadPart, sig] = token.split(".");
    // Decode, mutate, re-encode
    const decoded = JSON.parse(
      Buffer.from(payloadPart!, "base64url").toString("utf8")
    ) as Record<string, unknown>;
    decoded["role"] = "ADMIN";
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString(
      "base64url"
    );
    const tamperedToken = `${tamperedPayload}.${sig}`;
    expect(verifySessionToken(tamperedToken, SECRET_A, NOW)).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Tampering — signature
  // -----------------------------------------------------------------------
  it("rejects a token with a tampered signature (one char changed)", () => {
    const token = createSessionToken(PAYLOAD, SECRET_A);
    const [payloadPart, sig] = token.split(".");
    // Flip first char of signature
    const tamperedSig =
      sig!.charAt(0) === "A" ? "B" + sig!.slice(1) : "A" + sig!.slice(1);
    expect(
      verifySessionToken(`${payloadPart}.${tamperedSig}`, SECRET_A, NOW)
    ).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Wrong secret
  // -----------------------------------------------------------------------
  it("rejects a token verified with the wrong secret", () => {
    const token = createSessionToken(PAYLOAD, SECRET_A);
    expect(verifySessionToken(token, SECRET_B, NOW)).toBeNull();
  });

  it("two different secrets produce different signatures for the same payload", () => {
    const tokenA = createSessionToken(PAYLOAD, SECRET_A);
    const tokenB = createSessionToken(PAYLOAD, SECRET_B);
    expect(tokenA).not.toBe(tokenB);
  });

  // -----------------------------------------------------------------------
  // Garbage inputs
  // -----------------------------------------------------------------------
  it('rejects empty string ""', () => {
    expect(verifySessionToken("", SECRET_A, NOW)).toBeNull();
  });

  it('rejects "abc" (no dot)', () => {
    expect(verifySessionToken("abc", SECRET_A, NOW)).toBeNull();
  });

  it('rejects "a.b.c" (three parts)', () => {
    expect(verifySessionToken("a.b.c", SECRET_A, NOW)).toBeNull();
  });

  it('rejects "a." (empty signature)', () => {
    expect(verifySessionToken("a.", SECRET_A, NOW)).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Invalid role value in payload
  // -----------------------------------------------------------------------
  it("rejects a token with an invalid role value (SUPERUSER)", () => {
    const badPayload = { userId: "x", role: "SUPERUSER", expiresAtMs: NOW + 1 };
    // Build manually — we bypass createSessionToken which uses typed payload
    const payloadPart = Buffer.from(JSON.stringify(badPayload)).toString(
      "base64url"
    );
    const hmac = createHmac("sha256", SECRET_A);
    hmac.update(payloadPart);
    const sig = hmac.digest("base64url");
    const token = `${payloadPart}.${sig}`;
    expect(verifySessionToken(token, SECRET_A, NOW)).toBeNull();
  });
});
