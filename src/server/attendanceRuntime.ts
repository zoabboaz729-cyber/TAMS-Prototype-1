import { attendanceSecret } from "./attendanceTokens";
import { AttendancePolicySchema, DEFAULT_ATTENDANCE_POLICY, type AttendancePolicy } from "@/domain/attendanceRules";
import { AttendanceError } from "./attendanceErrors";
export function attendanceRuntime(env: Record<string, string | undefined> = process.env, realNow = new Date()): AttendanceRuntime {
    try {
        const secret = attendanceSecret(env);
        const simulated = env.M7_SYNTHETIC_DEMO === "true";
        let now = realNow;
        if (simulated) {
            if (env.NODE_ENV === "production" || env.DEMO_MODE !== "true" || !/^file:.*(?:\/|^)m7-demo[-\w]*\.db$/.test(env.DATABASE_URL ?? ""))
                throw new Error();
            const offset = Number(env.M7_DEMO_OFFSET_MINUTES);
            if (!Number.isInteger(offset) || Math.abs(offset) > 527040)
                throw new Error();
            now = new Date(realNow.getTime() + offset * 60000);
        }
        const policy = AttendancePolicySchema.parse({ ...DEFAULT_ATTENDANCE_POLICY, scanWindowKind: env.ATTENDANCE_WINDOW_KIND ?? DEFAULT_ATTENDANCE_POLICY.scanWindowKind, scanWindowMinutes: env.ATTENDANCE_WINDOW_MINUTES ? Number(env.ATTENDANCE_WINDOW_MINUTES) : 15 });
        const delta = now.getTime() - realNow.getTime();
        return { secret, now, realNow, simulated, policy, clock: () => new Date(Date.now() + delta) };
    }
    catch {
        throw new AttendanceError("CONFIGURATION");
    }
}
export type AttendanceRuntime = {
    secret: string;
    now: Date;
    realNow: Date;
    simulated: boolean;
    policy: AttendancePolicy;
    clock?: () => Date;
};
export function sampleAttendanceRuntime(r: AttendanceRuntime): AttendanceRuntime { return { ...r, now: r.clock?.() ?? r.now }; }
