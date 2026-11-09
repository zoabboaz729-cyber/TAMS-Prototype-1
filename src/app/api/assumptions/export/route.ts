import { authorizeApi } from "@/server/guards";
import { prisma } from "@/server/db";
import { readFindings } from "@/server/assumptionFeedback";
import { findingsCsv } from "@/domain/findingsCsv";
import { m8Json, privateHeaders } from "@/server/m8Http";
export const dynamic = "force-dynamic";
export async function GET() {
    const auth = await authorizeApi("EXPORT_ASSUMPTION_FINDINGS");
    if (!auth.ok) {
        auth.response.headers.set("Cache-Control", "private, no-store");
        return auth.response;
    }
    try {
        return new Response(findingsCsv(await readFindings(prisma, auth.user)), { headers: { ...privateHeaders, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tams-assumption-findings-${new Date().toISOString().slice(0, 10)}.csv"` } });
    }
    catch {
        return m8Json({ error: "unavailable", message: "Findings export unavailable. Retry or check the database." }, 503);
    }
}
