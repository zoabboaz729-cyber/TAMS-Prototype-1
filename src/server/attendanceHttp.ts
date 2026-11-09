import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCurrentUser } from "./auth";
import { isSameOriginRequest } from "./origin";
import { attendanceResult, refuse } from "./attendanceErrors";
export const privateAttendanceHeaders = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export function attendanceJson(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: privateAttendanceHeaders }); }
export async function attendanceActionActor() {
    const h = await headers();
    if (!isSameOriginRequest({ origin: h.get("origin"), host: h.get("host"), secFetchSite: h.get("sec-fetch-site") }))
        refuse("FORBIDDEN");
    const user = await getCurrentUser();
    if (!user)
        refuse("UNAUTHENTICATED");
    return user;
}
export function attendanceStatus(result: {
    ok: boolean;
    code?: string;
}) { return result.ok ? 200 : result.code === "UNAUTHENTICATED" ? 401 : result.code === "FORBIDDEN" ? 403 : result.code === "RATE_LIMITED" ? 429 : result.code === "RETRYABLE" ? 409 : result.code === "INTERNAL_ERROR" || result.code === "CONFIGURATION" ? 503 : 400; }
export async function attendanceTransport<T>(fn: () => Promise<T>) { const r = await attendanceResult(fn); return r.ok ? r.value : r; }
