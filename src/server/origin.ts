/**
 * Same-origin request check for TAMS auth routes.
 * Pure function: no Next.js imports, no database, never throws. Deny by default.
 *
 * Rules:
 * - If the Origin header is present, parse it with `new URL(origin)` inside a
 *   try/catch (an unparseable origin is rejected). Accept only when the parsed
 *   URL's host (including the port) equals the Host header value exactly, and
 *   the Host header is non-null.
 * - If the Origin header is absent, accept only when Sec-Fetch-Site is exactly
 *   "same-origin" or "none"; everything else (null, "cross-site", "same-site")
 *   is rejected.
 *
 * This protects POST /api/auth/login and POST /api/auth/logout from cross-site
 * form submission. Sec-Fetch-Site is a fallback for clients that omit Origin.
 */
export function isSameOriginRequest(h: {
  origin: string | null;
  host: string | null;
  secFetchSite: string | null;
}): boolean {
  const { origin, host, secFetchSite } = h;

  if (origin !== null) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return false;
    }
    return host !== null && parsed.host === host;
  }

  return secFetchSite === "same-origin" || secFetchSite === "none";
}