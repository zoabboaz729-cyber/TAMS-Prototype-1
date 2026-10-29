/**
 * Server-only auth helpers for TAMS.
 * Manages signed-cookie sessions using src/server/session.ts.
 * Must only be imported in Server Components, Route Handlers, and Server Actions.
 */
import { cookies } from "next/headers";
import { UserRole, UserRoleSchema } from "@/domain/types";
import {
  createSessionToken,
  verifySessionToken,
  SESSION_DURATION_MS,
} from "@/server/session";
import { verifyPassword } from "@/server/password";
import { normaliseEmail } from "./email";
import { prisma } from "@/server/db";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = "tams_session";

// ---------------------------------------------------------------------------
// Secret validation
// ---------------------------------------------------------------------------

/**
 * Reads and validates SESSION_SECRET from environment.
 * Throws a clear error if missing or shorter than 32 characters.
 * Call this lazily (at request time) so missing env fails loudly.
 */
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or shorter than 32 characters. " +
        "Set it in your .env file. See .env.example."
    );
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Cookie management
// ---------------------------------------------------------------------------

/**
 * Creates a signed session token and sets the session cookie.
 * Secure flag is only set in production (spec §4: SQLite demo prototype).
 */
export async function startSession(
  userId: string,
  role: UserRole
): Promise<void> {
  const secret = getSessionSecret();
  const expiresAtMs = Date.now() + SESSION_DURATION_MS;
  const token = createSessionToken({ userId, role, expiresAtMs }, secret);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(SESSION_DURATION_MS / 1000), // maxAge is in seconds
  });
}

/**
 * Clears the session cookie, ending the user's session.
 */
export async function endSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

// ---------------------------------------------------------------------------
// User retrieval
// ---------------------------------------------------------------------------

/** The safe User shape returned by auth functions — never includes passwordHash. */
export type SafeUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  departmentId: string | null;
  studentGroupId: string | null;
};

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  departmentId: true,
  studentGroupId: true,
} as const;

/**
 * Reads the session cookie, verifies the token, then loads the user from DB.
 * Returns null if the cookie is absent, the token is invalid/expired,
 * or the user no longer exists in the database.
 */
export async function getCurrentUser(): Promise<SafeUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;

    const secret = getSessionSecret();
    const payload = verifySessionToken(token, secret, Date.now());
    if (!payload) return null;

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: USER_SELECT,
    });
    if (!user) return null;

    const roleResult = UserRoleSchema.safeParse(user.role);
    if (!roleResult.success) return null;
    return { ...user, role: roleResult.data };
  } catch (error) {
    console.error(
      "[auth] getCurrentUser failed:",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Looks up a user by email and verifies their password.
 * Returns the safe user on success, or null on failure.
 * Callers cannot distinguish wrong email from wrong password (timing-safe via scrypt).
 */
export async function authenticate(
  email: string,
  password: string
): Promise<SafeUser | null> {
  try {
    const normalisedEmail = normaliseEmail(email);
    const user = await prisma.user.findUnique({
      where: { email: normalisedEmail },
      select: { ...USER_SELECT, passwordHash: true },
    });

    if (!user) {
      // Always run verifyPassword to prevent timing attacks that reveal
      // whether an email exists in the database.
      await verifyPassword(password, "scrypt$dummy$dummy");
      return null;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return null;

    // Return user without the hash
    const { passwordHash: _omit, ...safeUser } = user;
    const roleResult = UserRoleSchema.safeParse(safeUser.role);
    if (!roleResult.success) return null;
    return { ...safeUser, role: roleResult.data };
  } catch (error) {
    console.error(
      "[auth] authenticate failed:",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}
