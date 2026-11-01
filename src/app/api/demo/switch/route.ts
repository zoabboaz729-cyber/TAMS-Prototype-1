/**
 * POST /api/demo/switch
 * Switches the session to a demo account without a password.
 *
 * Six ordered checks (a to f), in order:
 *  a. 404 unless demo mode is enabled (DEMO_MODE === "true" and
 *     NODE_ENV !== "production") — the route does not exist otherwise.
 *  b. Same-origin check (Origin/Host plus Sec-Fetch-Site fallback) — 403 on
 *     failure, rejecting cross-site form posts.
 *  c. Configuration check (SESSION_SECRET) — 303 to /login?e=config on failure.
 *  d. Zod-validated `userId` form field (trimmed string, 1-100 chars) —
 *     303 to /login?e=bad_request on failure.
 *  e. Load the user by id and require a real demo account: it must exist,
 *     have a @demo.tams.test email, and a valid role. Unknown ids and
 *     non-demo accounts share one generic bad_request redirect, so no
 *     account enumeration is possible.
 *  f. startSession(user.id, role) then 303 redirect to "/".
 *
 * No password is ever read or accepted. Nothing is logged. Every redirect
 * target is a hard-coded same-origin constant.
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
import { z } from "zod";
import { isSameOriginRequest } from "@/server/origin";
import { isDemoEnabled, isDemoAccountEmail } from "@/server/demoMode";
import { getSessionSecret, startSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { UserRoleSchema } from "@/domain/types";

// ---------------------------------------------------------------------------
// Constants — all redirect targets are hard-coded same-origin paths.
// ---------------------------------------------------------------------------

const REDIRECT_LOGIN_CONFIG = "/login?e=config";
const REDIRECT_LOGIN_BAD_REQUEST = "/login?e=bad_request";
const REDIRECT_HOME = "/";

const UserIdSchema = z.object({
  userId: z.string().trim().min(1).max(100),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  // -------------------------------------------------------------------------
  // a. Demo mode must be enabled; otherwise the route does not exist.
  // -------------------------------------------------------------------------
  if (!isDemoEnabled(process.env.DEMO_MODE, process.env.NODE_ENV)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // -------------------------------------------------------------------------
  // b. Same-origin check — Origin header with Sec-Fetch-Site fallback.
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

  // -------------------------------------------------------------------------
  // c. Verify configuration before touching any input.
  // -------------------------------------------------------------------------
  try {
    getSessionSecret(); // throws if SESSION_SECRET is missing or too short
  } catch {
    return NextResponse.redirect(new URL(REDIRECT_LOGIN_CONFIG, request.url), {
      status: 303,
    });
  }

  // -------------------------------------------------------------------------
  // d. Parse and validate the userId form field.
  // -------------------------------------------------------------------------
  let userId: string;
  try {
    const formData = await request.formData();
    const parsed = UserIdSchema.safeParse({ userId: formData.get("userId") });
    if (!parsed.success) {
      return NextResponse.redirect(new URL(REDIRECT_LOGIN_BAD_REQUEST, request.url), {
        status: 303,
      });
    }
    userId = parsed.data.userId;
  } catch {
    return NextResponse.redirect(new URL(REDIRECT_LOGIN_BAD_REQUEST, request.url), {
      status: 303,
    });
  }

  // -------------------------------------------------------------------------
  // e. Load the user and require a real, validated demo account.
  //    Same response for unknown id and non-demo account (no enumeration).
  // -------------------------------------------------------------------------
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  });

  const roleResult = UserRoleSchema.safeParse(user?.role ?? "");
  if (!user || !isDemoAccountEmail(user.email) || !roleResult.success) {
    return NextResponse.redirect(new URL(REDIRECT_LOGIN_BAD_REQUEST, request.url), {
      status: 303,
    });
  }

  // -------------------------------------------------------------------------
  // f. Create the session and go home.
  // -------------------------------------------------------------------------
  await startSession(user.id, roleResult.data);
  return NextResponse.redirect(new URL(REDIRECT_HOME, request.url), { status: 303 });
}
