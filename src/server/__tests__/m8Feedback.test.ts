import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { m8Fixture, presenter } from './m8Fixture';
import { captureFeedback, readFindings } from '../assumptionFeedback';
import { auditFailure } from './m7Fixture';
let f: Awaited<ReturnType<typeof m8Fixture>>;
beforeAll(async () => { f = await m8Fixture(); }, 60000);
beforeEach(async () => { await f.db.auditLog.deleteMany(); await f.db.assumptionFeedback.deleteMany(); });
afterAll(async () => f?.close());
const input = () => ({ assumptionKey: 'A4', verdict: 'MODIFY', note: 'Rooms can be lent', sourceRole: 'DEPARTMENT_REP', meetingLabel: 'Discovery', submissionKey: randomUUID() });
it('append-only corrections and atomic audit, matching retry', async () => { const v = input(); const a = await captureFeedback(f.db, presenter, v); expect(await captureFeedback(f.db, presenter, v)).toEqual(a); await captureFeedback(f.db, presenter, { ...input(), verdict: 'REJECT' }); expect(await readFindings(f.db, presenter)).toHaveLength(2); expect(await f.db.auditLog.count()).toBe(2); expect(a.recordedByRole).toBe('OFFICER'); expect(a.sourceRole).toBe('DEPARTMENT_REP'); });
it('different payload with same key conflicts', async () => { const v = input(); await captureFeedback(f.db, presenter, v); await expect(captureFeedback(f.db, presenter, { ...v, note: 'different' })).rejects.toThrow('CONFLICT'); expect(await f.db.assumptionFeedback.count()).toBe(1); });
it('concurrent duplicate retries converge or can be safely retried', async () => { const v = input(); await Promise.allSettled([captureFeedback(f.db, presenter, v), captureFeedback(f.db, presenter, v)]); await captureFeedback(f.db, presenter, v); expect(await f.db.assumptionFeedback.count()).toBe(1); expect(await f.db.auditLog.count()).toBe(1); });
it('audit failure rolls back feedback', async () => { await expect(captureFeedback(auditFailure(f.db), presenter, input())).rejects.toThrow(); expect(await f.db.assumptionFeedback.count()).toBe(0); expect(await f.db.auditLog.count()).toBe(0); });
it.each(['STUDENT', 'LECTURER', 'DEPT_REP', 'APPROVER'] as const)('private data and writes denied to %s', async (role) => { const actor = { ...presenter, role }; await expect(readFindings(f.db, actor)).rejects.toThrow('FORBIDDEN'); await expect(captureFeedback(f.db, actor, input())).rejects.toThrow('FORBIDDEN'); expect(await f.db.assumptionFeedback.count()).toBe(0); expect(await f.db.auditLog.count()).toBe(0); });
it('signed out, forged recorder, invalid input and stale role commit zero writes', async () => {
    await expect(captureFeedback(f.db, null, input())).rejects.toThrow('FORBIDDEN');
    for (const v of [{ ...input(), recordedByRole: 'ADMIN' }, { ...input(), note: '' }, { ...input(), assumptionKey: 'A19' }])
        await expect(captureFeedback(f.db, presenter, v)).rejects.toThrow('INVALID');
    await expect(captureFeedback(f.db, { ...presenter, id: 'user-student-1' }, input())).rejects.toThrow('FORBIDDEN');
    expect(await f.db.assumptionFeedback.count()).toBe(0);
    expect(await f.db.auditLog.count()).toBe(0);
});
