import { NextRequest } from "next/server";
import { authorizeApi } from "@/server/guards";
import { prisma } from "@/server/db";
import { resetDemo } from "@/server/demoReset";
import { resetPolicy } from "@/domain/demoResetPolicy";
import { boundedJson, m8Json, m8SameOrigin } from "@/server/m8Http";
export async function POST(req: NextRequest) {
    if (!resetPolicy(process.env))
        return m8Json({ error: "disabled" }, 404);
    // Destructive reset is not authorized on a remotely hosted app.
    if (!["localhost", "127.0.0.1", "[::1]"].includes(req.nextUrl.hostname) || !m8SameOrigin(req))
        return m8Json({ error: "forbidden" }, 403);
    const auth = await authorizeApi("RESET_DEMO_DATA");
    if (!auth.ok) {
        auth.response.headers.set("Cache-Control", "private, no-store");
        return auth.response;
    }
    let input: unknown;
    try {
        input = await boundedJson(req);
    }
    catch {
        return m8Json({ error: "invalid", message: "Type RESET SAMPLE DATA." }, 400);
    }
    try {
        return m8Json({ ok: true, ...await resetDemo(prisma, auth.user, input) });
    }
    catch (e) {
        const code = e instanceof Error ? e.message : "";
        return m8Json({ error: "reset_refused", message: "Reset not confirmed. Check the disposable fixture configuration; findings must be retained." }, code === "INVALID" ? 400 : code === "FORBIDDEN" ? 403 : 503);
    }
}
