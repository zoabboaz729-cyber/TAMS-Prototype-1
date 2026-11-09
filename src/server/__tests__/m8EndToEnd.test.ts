import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { m8Fixture, presenter, admin } from './m8Fixture';
import { performDraftGenerate } from '../draftGenerate';
import { createDraftGenerateStore } from '../draftGenerateStorePrisma';
import { performDraftPublish } from '../draftPublish';
import { createDraftPublishStore } from '../draftPublishStorePrisma';
import { openAttendance, lecturerCredential, scanAttendance } from '../attendanceService';
import { reportClassActivity } from '../classActivity';
import { captureFeedback, readFindings } from '../assumptionFeedback';
import { findingsCsv } from '@/domain/findingsCsv';
import { resetDemo } from '../demoReset';
import { DEFAULT_ATTENDANCE_POLICY } from '@/domain/attendanceRules';
import { DEFAULT_POLICY } from '@/domain/policy';
import { demoReadiness } from '../demoReadiness';
import { attendanceReports } from '../attendanceReports';
import type { Actor } from '@/domain/permissions';
it('fresh synthetic seed → validated generation/publication → separate activity/scan → findings/export → safe reset', async () => {
    const f = await m8Fixture();
    const env = { ...f.env, DEMO_MODE: 'true', NODE_ENV: 'test', M8_DEMO_RESET_ENABLED: 'true', M8_DEMO_RESET_DATABASE_URL: f.url };
    try {
        const readiness = await demoReadiness(f.db, presenter, env);
        expect(readiness.find(r => r.label === 'Published timetable')?.state).toBe('NOT_READY');
        expect(readiness.find(r => r.label === 'QR demonstration')?.state).toBe('NOT_READY');
        expect(await f.db.timetableEntry.count()).toBe(10);
        const refused = await performDraftPublish(createDraftPublishStore(f.db), presenter, { versionId: 'ver-s1-planted' });
        expect(refused).toMatchObject({ ok: false, kind: 'HARD_VIOLATIONS' });
        // Explicit synthetic rehearsal preparation described in guide stage 3.
        // This fixture update represents the existing venue-register edit, not a seed or policy change.
        const unprepared = await performDraftGenerate(createDraftGenerateStore(f.db), presenter, { semester: 1, sourceVersionId: 'ver-s1-planted' });
        expect(unprepared).toMatchObject({ ok: false, kind: 'PARTIAL_GENERATION' });
        expect(await f.db.timetableVersion.count()).toBe(1);
        await f.db.venue.update({ where: { id: 'venue-LAB1' }, data: { capacity: 50 } });
        const generated = await performDraftGenerate(createDraftGenerateStore(f.db), presenter, { semester: 1, sourceVersionId: 'ver-s1-planted' });
        expect(generated.ok, JSON.stringify(generated)).toBe(true);
        if (!generated.ok)
            throw new Error('generation failed');
        const publication = await performDraftPublish(createDraftPublishStore(f.db), presenter, { versionId: generated.versionId }, DEFAULT_POLICY, () => new Date('2026-09-01T00:00:00Z'));
        expect(publication.ok, JSON.stringify(publication)).toBe(true);
        const entry = await f.db.timetableEntry.findFirstOrThrow({ where: { versionId: generated.versionId, teaching: { groupId: 'group-SE-Y4' } }, include: { teaching: { include: { lecturer: true } } }, orderBy: { start: 'asc' } });
        const days = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
        const date = `2026-11-${String(9 + days.indexOf(entry.day)).padStart(2, '0')}`, now = new Date(`${date}T${entry.start}:00+03:00`);
        now.setMinutes(now.getMinutes() + 1);
        const runtime = { secret: 'isolated-m8-attendance-secret-'.repeat(3), now, realNow: now, simulated: true, policy: DEFAULT_ATTENDANCE_POLICY };
        const lecturer: Actor = { id: entry.teaching.lecturer.userId, role: 'LECTURER', departmentId: entry.teaching.lecturer.departmentId, studentGroupId: null }, student: Actor = { id: 'user-student-1', role: 'STUDENT', departmentId: 'dept-computing', studentGroupId: 'group-SE-Y4' }, ref = { sourceEntryId: entry.id, originalDate: date };
        const opened = await openAttendance(f.db, lecturer, ref, runtime);
        expect(opened.ok, JSON.stringify(opened)).toBe(true);
        if (!opened.ok)
            throw new Error('open failed');
        expect(await f.db.classOccurrenceActivity.count()).toBe(0);
        expect((await reportClassActivity(f.db, lecturer, { ...ref, confirmVenue: true }, 'START', now)).ok).toBe(true);
        expect(await f.db.attendanceSession.count()).toBe(1);
        const credential = await lecturerCredential(f.db, lecturer, opened.value.sessionId, runtime);
        if (!credential.ok)
            throw new Error(JSON.stringify(credential));
        expect((await scanAttendance(f.db, student, { method: 'QR', token: credential.value.token }, runtime)).ok).toBe(true);
        expect(await scanAttendance(f.db, student, { method: 'QR', token: credential.value.token }, runtime)).toMatchObject({ code: 'ALREADY_RECORDED' });
        expect((await attendanceReports(f.db, presenter, {})).ok).toBe(true);
        await captureFeedback(f.db, presenter, { assumptionKey: 'A1', verdict: 'CONFIRM', submissionKey: randomUUID() });
        await captureFeedback(f.db, presenter, { assumptionKey: 'A4', verdict: 'MODIFY', note: 'Rooms are shared by agreement', submissionKey: randomUUID() });
        await captureFeedback(f.db, presenter, { assumptionKey: 'A4', verdict: 'REJECT', note: 'Correction after discussion', submissionKey: randomUUID() });
        const csv = findingsCsv(await readFindings(f.db, presenter));
        const reset = await resetDemo(f.db, admin, { confirmation: 'RESET SAMPLE DATA' }, env);
        expect(reset.before.records).toBe(1);
        expect(reset.after.records).toBe(0);
        expect(reset.after.captureAudits).toBe(3);
        expect(reset.after.feedback).toBe(3);
        expect(findingsCsv(await readFindings(f.db, presenter))).toBe(csv);
        expect(await f.db.timetableVersion.findMany()).toMatchObject([{ id: 'ver-s1-planted', status: 'DRAFT' }]);
        expect(await f.db.classOccurrenceActivity.count()).toBe(0);
        expect((await f.db.venue.findUniqueOrThrow({ where: { id: "venue-LAB1" } })).capacity).toBe(40);
    }
    finally {
        await f.close();
    }
}, 60000);
