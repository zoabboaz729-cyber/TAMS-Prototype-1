/**
 * POST /api/auth/logout
 * Clears the session cookie and redirects to the login page.
 *
 * Security notes:
 * - Logout is POST-only. A plain link (GET) cannot silently sign users out.
 * - endSession() is safe when no cookie exists — it is a no-op in that case.
 * - No session token is logged or returned in the response body.
 * - The redirect is always to the same-origin /login path.
 */
import { NextRequest, NextResponse } from "next/server";
import { endSession } from "@/server/auth";

export async function POST(_request: NextRequest): Promise<NextResponse> {
  // endSession deletes the cookie. It handles the missing-cookie case safely.
  await endSession();

  return NextResponse.redirect(new URL("/login", _request.url), {
    status: 303,
  });
}
