import { getCurrentUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { attendanceSummary } from "@/server/attendanceReports";
import { attendanceJson, attendanceStatus, attendanceTransport } from "@/server/attendanceHttp";
import { refuse } from "@/server/attendanceErrors";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const r = await attendanceTransport(async () => { const actor = await getCurrentUser(); if (!actor)
        refuse("UNAUTHENTICATED"); const { id } = await params; if (!id || id.length > 150)
        refuse("INVALID_INPUT"); return attendanceSummary(prisma, actor, id); });
    return attendanceJson(r, attendanceStatus(r));
}
