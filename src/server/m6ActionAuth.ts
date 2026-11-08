import { headers } from "next/headers";
import { getCurrentUser } from "./auth";
import { isSameOriginRequest } from "./origin";
import { ensure } from "./m6Errors";
export async function m6ActionActor() {
    const h = await headers();
    ensure(isSameOriginRequest({ origin: h.get("origin"), host: h.get("host"), secFetchSite: h.get("sec-fetch-site") }), "FORBIDDEN");
    return getCurrentUser();
}
