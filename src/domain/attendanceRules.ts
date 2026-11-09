/** Owner-approved synthetic attendance policy. All instants are injected. */
import { z } from "zod";
import { ISODateSchema, TimeSchema } from "./termCalendar";
export const AttendanceMode = z.enum(["STATIC", "ROTATING"]);
export const OccurrenceRef = z.object({ sourceEntryId: z.string().min(1).max(150), originalDate: ISODateSchema }).strict();
export const OpenInput = OccurrenceRef.extend({ mode: AttendanceMode.default("ROTATING") }).strict();
export const StartInput = OccurrenceRef.extend({ confirmVenue: z.literal(true) }).strict();
export const SessionInput = z.object({ sessionId: z.string().min(1).max(150) }).strict();
const deviceId = z.string().regex(/^[a-zA-Z0-9-]{8,100}$/).optional();
export const ScanInput = z.discriminatedUnion("method", [
    z.object({ method: z.literal("QR"), token: z.string().min(1).max(1024), deviceId }).strict(),
    z.object({ method: z.literal("CODE"), sessionId: z.string().min(1).max(150), code: z.string().min(1).max(32), deviceId }).strict(),
]);
export const AttendancePolicySchema = z.object({
    scanWindowKind: z.enum(["AFTER_OPEN_UNTIL_END", "FINAL_N_MINUTES"]),
    scanWindowMinutes: z.number().int().min(1).max(240),
    maxDurationMinutes: z.number().int().min(1).max(540),
}).strict();
export type AttendancePolicy = z.infer<typeof AttendancePolicySchema>;
export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = { scanWindowKind: "AFTER_OPEN_UNTIL_END", scanWindowMinutes: 15, maxDurationMinutes: 240 };
export function scheduledInstant(date: string, time: string): number {
    ISODateSchema.parse(date);
    TimeSchema.parse(time);
    return new Date(`${date}T${time}:00+03:00`).getTime();
}
export function computeScanWindow(date: string, start: string, end: string, nowMs: number, policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY) {
    AttendancePolicySchema.parse(policy);
    const starts = scheduledInstant(date, start), ends = scheduledInstant(date, end);
    if (!Number.isFinite(nowMs) || starts >= ends || nowMs < starts || nowMs >= ends)
        throw new Error("NOT_IN_OPEN_WINDOW");
    const closesAtMs = Math.min(ends, nowMs + policy.maxDurationMinutes * 60000);
    const scanFromMs = policy.scanWindowKind === "FINAL_N_MINUTES" ? Math.max(nowMs, ends - policy.scanWindowMinutes * 60000) : nowMs;
    if (scanFromMs >= closesAtMs)
        throw new Error("INVALID_POLICY");
    return { scanFromMs, closesAtMs };
}
export function scanDecision(input: {
    nowMs: number;
    opensAt: number;
    scanFrom: number;
    closesAt: number;
    status: string;
    groupId: string | null;
    requiredGroupId: string;
    duplicate: boolean;
    classEnded: boolean;
}): string | null {
    if (input.groupId === null || input.groupId !== input.requiredGroupId)
        return "FORBIDDEN";
    if (!["OPEN", "CLOSED", "CANCELLED"].includes(input.status))
        return "INVALID_STORED_DATA";
    if (input.status !== "OPEN")
        return "NOT_OPEN";
    if (![input.nowMs, input.opensAt, input.scanFrom, input.closesAt].every(Number.isFinite) || input.scanFrom < input.opensAt || input.scanFrom >= input.closesAt)
        return "INVALID_STORED_DATA";
    if (input.classEnded)
        return "CLASS_REPORTED_ENDED";
    if (input.nowMs < input.opensAt || input.nowMs < input.scanFrom)
        return "TOO_EARLY";
    if (input.nowMs >= input.closesAt)
        return "EXPIRED";
    if (input.duplicate)
        return "ALREADY_RECORDED";
    return null;
}
export function activityDecision(state: string | null, action: "START" | "END", now: number, start: number, end: number): string | null {
    if (state !== null && state !== "REPORTED_STARTED" && state !== "REPORTED_ENDED")
        return "INVALID_STORED_DATA";
    if (action === "END")
        return state === null ? "NOT_STARTED" : state === "REPORTED_ENDED" ? "ALREADY_ENDED" : null;
    if (state === "REPORTED_ENDED")
        return "ALREADY_ENDED";
    if (![now, start, end].every(Number.isFinite) || now < start || now >= end || start >= end)
        return "NOT_IN_OPEN_WINDOW";
    return state === "REPORTED_STARTED" ? "ALREADY_STARTED" : null;
}
export function attendanceDisplay(status: string | null, closesAt: number | null, now: number): string {
    if (status === null)
        return "NOT_OPENED";
    if (!["OPEN", "CLOSED", "CANCELLED"].includes(status))
        throw new Error("INVALID_STORED_DATA");
    return status === "OPEN" && closesAt !== null && now >= closesAt ? "EXPIRED" : status;
}
