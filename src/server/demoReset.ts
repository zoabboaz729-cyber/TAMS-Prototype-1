import { type PrismaClient, type Prisma } from "@prisma/client";
import { canAct, type Actor } from "@/domain/permissions";
import { ResetInput } from "@/domain/demoResetPolicy";
import { resetTarget, assertConnectedTarget } from "./demoResetTarget";
import { seedDepartments, seedVenues, seedVenueUnavailabilities, seedStudentGroups, seedUsers, seedLecturers, seedLecturerAvailabilities, seedUnits, seedTeachings, seedSubmissions, seedIssues, seedTimetableVersions, seedTimetableEntries, } from "@/domain/seedData";
export async function assertSyntheticFixture(tx: Prisma.TransactionClient) {
    const users = await tx.user.findMany();
    if (users.length !== seedUsers.length || users.some(u => !seedUsers.some(s => s.id === u.id && s.email === u.email && s.role === u.role && s.departmentId === u.departmentId && s.studentGroupId === u.studentGroupId)))
        throw new Error("UNEXPECTED_DATA");
    const sets = [await tx.department.findMany(), await tx.studentGroup.findMany(), await tx.lecturer.findMany(), await tx.unit.findMany(), await tx.teaching.findMany(), await tx.venue.findMany()];
    const seeds = [seedDepartments, seedStudentGroups, seedLecturers, seedUnits, seedTeachings, seedVenues];
    for (let i = 0; i < sets.length; i++)
        if (sets[i].some(row => !seeds[i].some(s => s.id === row.id)))
            throw new Error("UNEXPECTED_DATA");
    const findings = await tx.assumptionFeedback.findMany(), audits = await tx.auditLog.findMany({ where: { action: "ASSUMPTION_FEEDBACK_CAPTURED" } });
    if (audits.some(a => !findings.some(f => f.id === a.entityId) || (a.actorId !== null && !seedUsers.some(u => u.id === a.actorId))))
        throw new Error("UNEXPECTED_DATA");
}
export async function restoreSyntheticOperations(tx: Prisma.TransactionClient) {
    await tx.attendanceAttempt.deleteMany();
    await tx.classOccurrenceActivity.deleteMany();
    await tx.attendanceRecord.deleteMany();
    await tx.attendanceSession.deleteMany();
    await tx.rescheduleRequest.deleteMany();
    await tx.timetableOccurrenceException.deleteMany();
    await tx.timetableEntry.deleteMany();
    await tx.timetableVersion.updateMany({ data: { basePublishedVersionId: null } });
    await tx.timetableVersion.deleteMany();
    await tx.issue.deleteMany();
    await tx.submission.deleteMany();
    await tx.teaching.deleteMany();
    await tx.lecturerAvailability.deleteMany();
    await tx.lecturer.deleteMany();
    await tx.unit.deleteMany();
    await tx.venueUnavailable.deleteMany();
    await tx.venue.deleteMany();
    await tx.auditLog.deleteMany({ where: { action: { not: "ASSUMPTION_FEEDBACK_CAPTURED" } } });
    for (const d of seedDepartments)
        await tx.department.upsert({ where: { id: d.id }, create: d, update: d });
    for (const g of seedStudentGroups)
        await tx.studentGroup.upsert({ where: { id: g.id }, create: g, update: g });
    await tx.venue.createMany({
        data: seedVenues.map((venue) => ({
            ...venue,
            facilities: JSON.stringify(venue.facilities),
        })),
    });
    await tx.venueUnavailable.createMany({
        data: seedVenueUnavailabilities,
    });
    await tx.lecturer.createMany({
        data: seedLecturers,
    });
    await tx.lecturerAvailability.createMany({
        data: seedLecturerAvailabilities,
    });
    await tx.unit.createMany({
        data: seedUnits,
    });
    await tx.teaching.createMany({
        data: seedTeachings,
    });
    await tx.submission.createMany({
        data: seedSubmissions,
    });
    await tx.issue.createMany({
        data: seedIssues,
    });
    await tx.timetableVersion.createMany({
        data: seedTimetableVersions,
    });
    await tx.timetableEntry.createMany({
        data: seedTimetableEntries,
    });
}
export async function resetDemo(db: PrismaClient, actor: Actor | null, input: unknown, env: Record<string, string | undefined> = process.env) {
    if (!canAct(actor, "RESET_DEMO_DATA") || !actor)
        throw new Error("FORBIDDEN");
    if (!ResetInput.safeParse(input).success)
        throw new Error("INVALID");
    const target = await resetTarget(env);
    return db.$transaction(async (tx) => {
        await assertConnectedTarget(tx, target);
        // Acquire SQLite's write lock before reading the synthetic snapshot.
        const locked = await tx.$executeRaw `UPDATE "User" SET "id"="id" WHERE "id"=${actor.id} AND "role"='ADMIN' AND "email"='admin@demo.tams.test'`;
        if (locked !== 1)
            throw new Error("FORBIDDEN");
        await assertSyntheticFixture(tx);
        const before = { feedback: await tx.assumptionFeedback.count(), captureAudits: await tx.auditLog.count({ where: { action: "ASSUMPTION_FEEDBACK_CAPTURED" } }), versions: await tx.timetableVersion.count(), sessions: await tx.attendanceSession.count(), records: await tx.attendanceRecord.count() };
        await restoreSyntheticOperations(tx);
        const after = { feedback: await tx.assumptionFeedback.count(), captureAudits: await tx.auditLog.count({ where: { action: "ASSUMPTION_FEEDBACK_CAPTURED" } }), versions: await tx.timetableVersion.count(), sessions: await tx.attendanceSession.count(), records: await tx.attendanceRecord.count() };
        if (before.feedback !== after.feedback || before.captureAudits !== after.captureAudits)
            throw new Error("PRESERVATION_FAILED");
        return { before, after };
    }, { timeout: 20000 });
}
