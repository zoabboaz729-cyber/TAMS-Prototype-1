import type { PrismaClient } from "@prisma/client";
import { canAct, type Actor } from "@/domain/permissions";
import { seedUsers } from "@/domain/seedData";
import { attendanceRuntime } from "./attendanceRuntime";
import { lecturerAttendanceList } from "./attendanceReads";
import { assertSyntheticFixture } from "./demoReset";
import { AttendanceError } from "./attendanceErrors";
import { resetTarget, assertConnectedTarget } from "./demoResetTarget";
export type Readiness = {
    label: string;
    state: "READY" | "NOT_READY" | "ERROR" | "BLOCKED";
    message: string;
};
export async function demoReadiness(db: PrismaClient, actor: Actor | null, env: Record<string, string | undefined> = process.env): Promise<Readiness[]> {
    if (!canAct(actor, "VIEW_DEMO_GUIDE"))
        throw new Error("FORBIDDEN");
    try {
        const users = await db.user.findMany({ select: { id: true, email: true, role: true, departmentId: true, studentGroupId: true } });
        const seeded = seedUsers.every(s => users.some(u => u.id === s.id && u.email === s.email && u.role === s.role));
        const [drafts, published, venues, approved] = await Promise.all([db.timetableVersion.count({ where: { status: "DRAFT", semester: 1 } }), db.timetableVersion.findMany({ where: { status: "PUBLISHED", semester: 1 } }), db.venue.count(), db.submission.count({ where: { status: "APPROVED", semester: 1 } })]);
        await db.assumptionFeedback.count();
        const pub = published.length === 1 && !!published[0].publishedAt;
        const check = (label: string, ok: boolean, message: string): Readiness => ({ label, state: ok ? "READY" : "NOT_READY", message });
        const rows = [check("Synthetic mode", env.DEMO_MODE === "true" && env.NODE_ENV !== "production" && seeded, "Demo switching requires exact DEMO_MODE=true, nonproduction and seeded synthetic accounts."), check("Database", seeded, "Connection available; verify all sample accounts are seeded."), check("Department submission", approved > 0, "Submit and approve sample requirements during the guide."), check("Draft", drafts > 0, "Original seed intentionally has two planted clashes. Full generation also requires stage 3 synthetic lab-capacity preparation: LAB1 is 40, SE-Y4 is 45."), check("Published timetable", pub, "Publish a validated conflict-free Semester 1 candidate first."), check("Venue views", pub && venues > 0, "Venue status is schedule-derived; reservations are not verified occupancy."), check("Findings CSV", true, "Feedback storage available. Export records all chronological stakeholder statements.")];
        let qr = false, qrError = false;
        try {
            const runtime = attendanceRuntime(env);
            if (runtime.simulated && seeded && pub) {
                for (const user of users.filter(u => u.role === "LECTURER")) {
                    const r = await lecturerAttendanceList(db, user as Actor, runtime, 1);
                    if (!r.ok) {
                        if (r.code === "INTERNAL_ERROR")
                            qrError = true;
                        continue;
                    }
                    for (const occurrence of r.value.rows.filter(o => o.inWindow)) {
                        const eligible = await db.timetableEntry.count({where:{id:occurrence.sourceEntryId,teaching:{group:{students:{some:{role:"STUDENT",email:{endsWith:"@demo.tams.test"}}}}}}});
                        if (eligible > 0) qr = true;
                    }
                }
            }
        }
        catch (error) {
            if (!(error instanceof AttendanceError && error.code === "CONFIGURATION")) qrError = true;
        }
        const qrCheck = check("QR demonstration", qr, "Requires M7 synthetic server clock, token secret, matching effective Semester 1 lesson and eligible sample accounts. M5 URL/display time cannot substitute. Start class independently uses real time. Semester 2 dates are unconfigured.");
        if (qrError) {
            qrCheck.state = "ERROR";
            qrCheck.message = "Attendance data unavailable. Check the database; QR readiness is unknown.";
        }
        rows.push(qrCheck);
        let safe = false;
        try {
            const target = await resetTarget(env);
            await db.$transaction(async tx => {
                await assertConnectedTarget(tx, target);
                await assertSyntheticFixture(tx);
            });
            safe = actor?.id === "user-admin" && actor.role === "ADMIN";
        }
        catch { /* fail closed */ }
        rows.push({ label: "Reset permission", state: actor?.role === "ADMIN" && safe ? "READY" : "BLOCKED", message: "ADMIN only, local host, explicit extra flag and canonical disposable database. All findings and capture audits retained." });
        return rows;
    }
    catch {
        return [{ label: "Database", state: "ERROR", message: "Data unavailable. Retry or ask the demo operator to check the database; readiness is unknown." }];
    }
}
