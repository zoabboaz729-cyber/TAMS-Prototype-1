import { getCurrentUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { isSameOriginRequest } from "@/server/origin";
import { scanAttendance } from "@/server/attendanceService";
import { attendanceRuntime } from "@/server/attendanceRuntime";
import { attendanceJson, attendanceStatus, attendanceTransport } from "@/server/attendanceHttp";
import { refuse } from "@/server/attendanceErrors";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
    const result = await attendanceTransport(async () => {
        if (!isSameOriginRequest({ origin: request.headers.get("origin"), host: request.headers.get("host"), secFetchSite: request.headers.get("sec-fetch-site") }))
            refuse("FORBIDDEN");
        const user = await getCurrentUser();
        if (!user)
            refuse("UNAUTHENTICATED");
        if (user.role !== "STUDENT")
            refuse("FORBIDDEN");
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
            refuse("INVALID_INPUT");
        if (Number(request.headers.get("content-length") ?? 0) > 8192)
            refuse("INVALID_INPUT");
        let input: unknown;
        try {
            const text = await request.text();
            if (text.length > 8192)
                refuse("INVALID_INPUT");
            input = JSON.parse(text);
        }
        catch {
            refuse("INVALID_INPUT");
        }
        return scanAttendance(prisma, user, input, attendanceRuntime());
    });
    return attendanceJson(result, attendanceStatus(result));
}
