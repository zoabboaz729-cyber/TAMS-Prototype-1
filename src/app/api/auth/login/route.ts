/**
 * POST /api/auth/login
 * Validates submitted credentials, creates a session on success, and redirects.
 *
 * Security notes:
 * - Zod validates the form body; malformed input is rejected with a redirect.
 * - Wrong email and wrong password produce the same public error code.
 * - A configuration failure (missing SESSION_SECRET) is distinguished from
 *   invalid credentials so it cannot be silently hidden from the operator.
 * - No credentials, hashes, or tokens are logged.
 * - The redirect target is always a hard-coded same-origin path; no external
 *   URL can be injected through form data.
 */
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/server/origin";
import { LoginSchema } from "@/server/loginSchema";
import { authenticate, startSession, getSessionSecret } from "@/server/auth";

// Redirect helpers — all paths are same-origin constants.
const REDIRECT_HOME = "/";
const REDIRECT_LOGIN_BAD = "/login?e=invalid_credentials";
const REDIRECT_LOGIN_CONFIG = "/login?e=config";
const REDIRECT_LOGIN_BAD_REQUEST = "/login?e=bad_request";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // -------------------------------------------------------------------------
  // 0. Same-origin check — Origin header with Sec-Fetch-Site fallback.
  //    Deny by default: nothing else runs if this fails.
  // -------------------------------------------------------------------------
  if (
    !isSameOriginRequest({
      origin: request.headers.get("origin"),
      host: request.headers.get("host"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    })
  ) {
    return NextResponse.redirect(
      new URL(REDIRECT_LOGIN_BAD_REQUEST, request.url),
      { status: 303 },
    );
  }

  // -------------------------------------------------------------------------
  // 1. Verify configuration before touching credentials.
  //    If SESSION_SECRET is missing, report a config error — not an auth error.
  // -------------------------------------------------------------------------
  try {
    getSessionSecret(); // throws if SECRET is missing or too short
  } catch {
    // Do not log the exception; it contains no credential data but the message
    // is operator-facing rather than user-facing.
    return NextResponse.redirect(
      new URL(REDIRECT_LOGIN_CONFIG, request.url),
      { status: 303 }
    );
  }

  // -------------------------------------------------------------------------
  // 2. Parse and validate form body.
  // -------------------------------------------------------------------------
  let email: string;
  let password: string;

  try {
    const formData = await request.formData();
    const raw = {
      email: formData.get("email"),
      password: formData.get("password"),
    };
    const parsed = LoginSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.redirect(
        new URL(REDIRECT_LOGIN_BAD_REQUEST, request.url),
        { status: 303 }
      );
    }
    email = parsed.data.email;
    password = parsed.data.password;
  } catch {
    return NextResponse.redirect(
      new URL(REDIRECT_LOGIN_BAD_REQUEST, request.url),
      { status: 303 }
    );
  }

  // -------------------------------------------------------------------------
  // 3. Authenticate — wrong email and wrong password are indistinguishable.
  // -------------------------------------------------------------------------
  const user = await authenticate(email, password);

  if (!user) {
    return NextResponse.redirect(
      new URL(REDIRECT_LOGIN_BAD, request.url),
      { status: 303 }
    );
  }

  // -------------------------------------------------------------------------
  // 4. Authentication succeeded — create the session and redirect home.
  //    startSession() is called ONLY after authenticate() returns a user.
  // -------------------------------------------------------------------------
  try {
    await startSession(user.id, user.role);
  } catch {
    // Session creation can fail if the secret becomes unavailable mid-request
    // or an unexpected crypto error occurs. Report config, not auth failure.
    return NextResponse.redirect(
      new URL(REDIRECT_LOGIN_CONFIG, request.url),
      { status: 303 }
    );
  }

  return NextResponse.redirect(new URL(REDIRECT_HOME, request.url), {
    status: 303,
  });
}
