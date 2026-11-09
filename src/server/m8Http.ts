import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "./origin";
export const privateHeaders = { "Cache-Control": "private, no-store" };
export function m8Json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: privateHeaders }); }
export function m8SameOrigin(req: NextRequest) {
    const origin = req.headers.get("origin"), site = req.headers.get("sec-fetch-site");
    return origin !== null && (site === null || site === "same-origin" || site === "none") && origin === req.nextUrl.origin && isSameOriginRequest({ origin, host: req.headers.get("host"), secFetchSite: site });
}
export async function boundedJson(req: NextRequest): Promise<unknown> {
    // Bound actual streamed bytes, not just the untrusted Content-Length header.
    const reader = req.body?.getReader();
    if (!reader)
        throw new Error("INVALID");
    let size = 0;
    const parts: Uint8Array[] = [];
    while (true) {
        const r = await reader.read();
        if (r.done)
            break;
        size += r.value.byteLength;
        if (size > 16384) {
            await reader.cancel();
            throw new Error("INVALID");
        }
        parts.push(r.value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
