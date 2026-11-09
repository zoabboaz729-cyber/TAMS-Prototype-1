import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { symlinkSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { m8Fixture, admin, presenter } from './m8Fixture';
import { resetDemo } from '../demoReset';
import { resetTarget } from '../demoResetTarget';
import { captureFeedback } from '../assumptionFeedback';
import { findingsCsv } from '@/domain/findingsCsv';
import type { PrismaClient, Prisma } from '@prisma/client';
let f: Awaited<ReturnType<typeof m8Fixture>>;
beforeAll(async () => { f = await m8Fixture(); }, 60000);
afterAll(async () => f?.close());
const input = { confirmation: 'RESET SAMPLE DATA' };
const config = () => ({ ...f.env, NODE_ENV: 'test', DEMO_MODE: 'true', M8_DEMO_RESET_ENABLED: 'true', M8_DEMO_RESET_DATABASE_URL: f.url });
it('two atomic resets preserve exact findings, capture audits and identities', async () => {
    await captureFeedback(f.db, presenter, { assumptionKey: 'A4', verdict: 'MODIFY', note: '=SUM(1,2)\nUnicode é', submissionKey: randomUUID() });
    const findings = await f.db.assumptionFeedback.findMany(), audit = await f.db.auditLog.findMany(), users = await f.db.user.findMany({ orderBy: { id: 'asc' } }), csv = findingsCsv(findings);
    await f.db.issue.updateMany({ data: { status: 'RESOLVED' } });
    await f.db.timetableVersion.create({ data: { id: 'extra', semester: 1, createdBy: presenter.id } });
    for (let i = 0; i < 2; i++) {
        const r = await resetDemo(f.db, admin, input, config());
        expect(r.before.feedback).toBe(r.after.feedback);
        expect(await f.db.assumptionFeedback.findMany()).toEqual(findings);
        expect(findingsCsv(await f.db.assumptionFeedback.findMany())).toBe(csv);
        expect(await f.db.auditLog.findMany()).toEqual(audit);
        expect(await f.db.user.findMany({ orderBy: { id: 'asc' } })).toEqual(users);
        expect(await f.db.timetableVersion.findMany()).toMatchObject([{ id: 'ver-s1-planted', status: 'DRAFT' }]);
        expect(await f.db.timetableEntry.count()).toBe(10);
        expect(await f.db.issue.findFirst()).toMatchObject({ status: 'OPEN' });
        expect(await f.db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
    }
});
it('forbidden, bad confirmation and disabled flags commit zero changes', async () => {
    const before = await f.db.timetableEntry.findMany();
    for (const a of [null, presenter, { ...admin, id: 'user-officer' }])
        await expect(resetDemo(f.db, a, input, config())).rejects.toThrow();
    await expect(resetDemo(f.db, admin, { confirmation: 'bad' }, config())).rejects.toThrow('INVALID');
    await expect(resetDemo(f.db, admin, input, { ...config(), NODE_ENV: 'production' })).rejects.toThrow('BLOCKED');
    expect(await f.db.timetableEntry.findMany()).toEqual(before);
});
it('unknown users and non-demo master records refuse before deleting', async () => { await f.db.user.create({ data: { id: 'unknown', email: 'external@invalid.test', name: 'Synthetic external sentinel', passwordHash: 'x', role: 'ADMIN' } }); const before = await f.db.timetableEntry.findMany(); await expect(resetDemo(f.db, admin, input, config())).rejects.toThrow('UNEXPECTED_DATA'); expect(await f.db.timetableEntry.findMany()).toEqual(before); await f.db.user.delete({ where: { id: 'unknown' } }); await f.db.venue.create({ data: { id: 'unknown-venue', code: 'SENTINEL', type: 'ROOM', capacity: 1 } }); await expect(resetDemo(f.db, admin, input, config())).rejects.toThrow('UNEXPECTED_DATA'); expect(await f.db.venue.count()).toBe(10); await f.db.venue.delete({ where: { id: 'unknown-venue' } }); });
it('mid-reset failure rolls back every operational delete', async () => {
    const before = await f.db.timetableEntry.findMany();
    const bad = new Proxy(f.db, { get(t, k, r) {
            if (k !== '$transaction')
                return Reflect.get(t, k, r);
            return (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => t.$transaction(tx => fn(new Proxy(tx, { get(a, b, c) { return b === 'venue' ? { ...a.venue, createMany: () => { throw new Error('injected'); } } : Reflect.get(a, b, c); } })));
        } }) as PrismaClient;
    await expect(resetDemo(bad, admin, input, config())).rejects.toThrow('injected');
    expect(await f.db.timetableEntry.findMany()).toEqual(before);
    expect(await f.db.venue.count()).toBe(9);
    expect(await f.db.assumptionFeedback.count()).toBeGreaterThan(0);
});
it('canonical symlinks and mismatched actual connection are denied', async () => {
    const link = f.file.replace('.db', '-link.db'), url = f.url.replace('.db', '-link.db');
    symlinkSync(f.file, link);
    try {
        await expect(resetTarget({ ...config(), DATABASE_URL: url, M8_DEMO_RESET_DATABASE_URL: url })).rejects.toThrow('BLOCKED');
    }
    finally {
        unlinkSync(link);
    }
    const other = await m8Fixture();
    try {
        await expect(resetDemo(f.db, admin, input, { ...config(), DATABASE_URL: other.url, M8_DEMO_RESET_DATABASE_URL: other.url })).rejects.toThrow('BLOCKED');
    }
    finally {
        await other.close();
    }
}, 60000);
it('CLI refuses before deleting captured findings, including audits and operational state', async () => {
    const before = await f.db.assumptionFeedback.findMany(), ops = await f.db.timetableEntry.findMany();
    let error = '';
    try {
        execFileSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], { env: f.env, stdio: 'pipe' });
    }
    catch (e) {
        error = String(e);
    }
    expect(error).toContain('Seed refused: meeting findings exist');
    expect(await f.db.assumptionFeedback.findMany()).toEqual(before);
    expect(await f.db.timetableEntry.findMany()).toEqual(ops);
});
it('concurrent capture and reset retain every committed finding without half resets', async () => { const v = { assumptionKey: 'A2', verdict: 'CONFIRM', submissionKey: randomUUID() }; await Promise.allSettled([resetDemo(f.db, admin, input, config()), captureFeedback(f.db, presenter, v)]); await captureFeedback(f.db, presenter, v); await resetDemo(f.db, admin, input, config()); expect(await f.db.assumptionFeedback.count({ where: { submissionKey: v.submissionKey } })).toBe(1); expect(await f.db.auditLog.count({ where: { action: 'ASSUMPTION_FEEDBACK_CAPTURED' } })).toBe(await f.db.assumptionFeedback.count()); expect(await f.db.timetableEntry.count()).toBe(10); });
it('normal no-findings CLI seed remains deterministic across two runs', async () => { const isolated = await m8Fixture(); try {
    const select={id:true,versionId:true,teachingId:true,venueId:true,day:true,start:true,end:true,locked:true} as const;
        // Logical fixture determinism: operational creation/update timestamps intentionally renew.
        const first = await isolated.db.timetableEntry.findMany({select, orderBy: { id: 'asc' } });
    for (let i = 0; i < 2; i++)
        execFileSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], { env: isolated.env, stdio: 'pipe' });
    expect(await isolated.db.timetableEntry.findMany({select, orderBy: { id: 'asc' } })).toEqual(first);
    expect(await isolated.db.user.count()).toBe(17);
}
finally {
    await isolated.close();
} }, 60000);
