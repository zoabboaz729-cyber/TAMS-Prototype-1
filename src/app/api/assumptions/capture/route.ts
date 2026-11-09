import { NextRequest } from "next/server";
import { authorizeApi } from "@/server/guards";
import { prisma } from "@/server/db";
import { captureFeedback, FeedbackError } from "@/server/assumptionFeedback";
import { boundedJson, m8SameOrigin, m8Json, privateHeaders } from "@/server/m8Http";
export async function POST(req: NextRequest) {
    if (!m8SameOrigin(req))
        return m8Json({ error: "forbidden" }, 403);
    const auth = await authorizeApi("CAPTURE_ASSUMPTION_FEEDBACK");
    if (!auth.ok) {
        auth.response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
        return auth.response;
    }
    let input: unknown;
    try {
        input = await boundedJson(req);
    }
    catch {
        return m8Json({ error: "INVALID", message: "Check the feedback fields and request size." }, 400);
    }
    try {
        const row = await captureFeedback(prisma, auth.user, input);
        return m8Json({ id: row.id, assumptionKey: row.assumptionKey });
    }
    catch (e) {
        if (e instanceof FeedbackError)
            return m8Json({ error: e.code, message: e.code === "CONFLICT" ? "Submission key already used for different feedback. Review history." : "Check your feedback fields and presenter access." }, e.code === "FORBIDDEN" ? 403 : e.code === "CONFLICT" ? 409 : 400);
        return m8Json({ error: "UNAVAILABLE", message: "Feedback was not confirmed saved; check your findings history before retrying." }, 503);
    }
}
