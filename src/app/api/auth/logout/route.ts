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
import { isSameOriginRequest } from "@/server/origin";
import { endSession } from "@/server/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // -------------------------------------------------------------------------
  // 0. Same-origin check — Origin header with Sec-Fetch-Site fallback.
  //    Deny by default: on failure the cookie is NOT cleared and no session
  //    state is touched.
  // -------------------------------------------------------------------------
  if (
    !isSameOriginRequest({
      origin: request.headers.get("origin"),
      host: request.headers.get("host"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    })
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // endSession deletes the cookie. It handles the missing-cookie case safely.
  await endSession();

  return NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
}
