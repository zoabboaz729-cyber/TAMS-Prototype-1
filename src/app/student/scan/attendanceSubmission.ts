import { z } from "zod";
const Receipt = z.object({ ok: z.literal(true), value: z.object({ recordId: z.string().min(1), recordedAt: z.string().datetime(), simulated: z.boolean() }) });
const Failure = z.object({ ok: z.literal(false), code: z.string(), message: z.string() });
export type ScanSubmission = {
    method: "QR";
    token: string;
    deviceId?: string;
} | {
    method: "CODE";
    sessionId: string;
    code: string;
    deviceId?: string;
};
export type SubmissionOutcome = {
    kind: "CONFIRMED";
    message: string;
} | {
    kind: "REJECTED";
    message: string;
} | {
    kind: "UNKNOWN";
    message: string;
};
/** A network failure or malformed response never produces a confirmation. */
export async function sendAttendance(input: ScanSubmission, fetcher: typeof fetch = fetch): Promise<SubmissionOutcome> {
    try {
        const response = await fetcher("/api/attendance/scan", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(input) });
        const data: unknown = await response.json(), receipt = Receipt.safeParse(data);
        if (response.ok && receipt.success)
            return { kind: "CONFIRMED", message: `${receipt.data.value.simulated ? "Synthetic simulation — " : ""}Server-confirmed attendance at ${receipt.data.value.recordedAt}. Receipt ${receipt.data.value.recordId}.` };
        const failure = Failure.safeParse(data);
        if (failure.success)
            return { kind: "REJECTED", message: failure.data.message };
    }
    catch { /* Lost responses must remain distinguishable from rejection or confirmation. */ }
    return { kind: "UNKNOWN", message: "Outcome unknown: the network response was lost or invalid. Check your attendance history, then retry if necessary. Attendance is not confirmed on this screen." };
}
