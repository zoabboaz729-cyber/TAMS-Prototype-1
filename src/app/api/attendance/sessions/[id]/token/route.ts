import QRCode from "qrcode";
import { getCurrentUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { lecturerCredential } from "@/server/attendanceService";
import { attendanceRuntime } from "@/server/attendanceRuntime";
import { attendanceJson, attendanceStatus, attendanceTransport } from "@/server/attendanceHttp";
import { refuse } from "@/server/attendanceErrors";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const result = await attendanceTransport(async () => {
        const actor = await getCurrentUser();
        if (!actor)
            refuse("UNAUTHENTICATED");
        if (actor.role !== "LECTURER")
            refuse("FORBIDDEN");
        const { id } = await params;
        if (!id || id.length > 150)
            refuse("INVALID_INPUT");
        const r = await lecturerCredential(prisma, actor, id, attendanceRuntime());
        if (!r.ok)
            return r;
        const image = await QRCode.toDataURL(r.value.token, { width: 320, margin: 2, errorCorrectionLevel: "M" });
        return { ok: true as const, value: { ...r.value, image } };
    });
    return attendanceJson(result, attendanceStatus(result));
}
