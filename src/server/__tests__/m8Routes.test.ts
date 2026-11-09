import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { SafeUser } from '../auth';
import { m8Fixture, presenter, admin } from './m8Fixture';
(globalThis as {
    React?: typeof React;
}).React = React;
const h = vi.hoisted(() => ({ db: null as PrismaClient | null, user: null as SafeUser | null, failed: false }));
vi.mock('@/server/db', () => ({ get prisma() {
        if (h.failed)
            throw new Error('private database detail');
        return h.db;
    } }));
vi.mock('@/server/auth', () => ({ getCurrentUser: async () => h.user }));
vi.mock('@/app/assumptions/FeedbackForm', () => ({ default: ({ assumptionKey }: {
        assumptionKey: string;
    }) => React.createElement('span', null, `Capture ${assumptionKey}`) }));
const capture = await import('@/app/api/assumptions/capture/route');
const download = await import('@/app/api/assumptions/export/route');
const reset = await import('@/app/api/demo/reset/route');
const { default: Page } = await import('@/app/assumptions/page');
let f: Awaited<ReturnType<typeof m8Fixture>>;
const safe = (a: typeof presenter | typeof admin): SafeUser => ({ ...a, name: 'Synthetic', email: a.id === 'user-admin' ? 'admin@demo.tams.test' : 'officer@demo.tams.test' });
beforeAll(async () => { f = await m8Fixture(); h.db = f.db; }, 60000);
beforeEach(async () => { h.user = safe(presenter); h.failed = false; await f.db.auditLog.deleteMany(); await f.db.assumptionFeedback.deleteMany(); vi.stubEnv('DATABASE_URL', f.url); vi.stubEnv('M8_DEMO_RESET_DATABASE_URL', f.url); vi.stubEnv('M8_DEMO_RESET_ENABLED', 'true'); vi.stubEnv('DEMO_MODE', 'true'); vi.stubEnv('NODE_ENV', 'test'); });
afterAll(async () => { vi.unstubAllEnvs(); await f?.close(); });
const data = () => ({ assumptionKey: 'A1', verdict: 'CONFIRM', note: '<script>private finding</script>', submissionKey: randomUUID() });
const req = (path: string, body: unknown, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
it.each(['STUDENT', 'LECTURER', 'DEPT_REP', 'APPROVER'] as const)('direct private requests denied to %s with zero writes', async (role) => { h.user = { ...safe(presenter), role }; expect((await capture.POST(req('/api/assumptions/capture', data()))).status).toBe(403); expect((await download.GET()).status).toBe(403); expect((await reset.POST(req('/api/demo/reset', { confirmation: 'RESET SAMPLE DATA' }))).status).toBe(403); expect(await f.db.assumptionFeedback.count()).toBe(0); expect(await f.db.auditLog.count()).toBe(0); });
it('signed-out and forged/missing origins never write', async () => {
    h.user = null;
    expect((await capture.POST(req('/api/assumptions/capture', data()))).status).toBe(401);
    expect((await download.GET()).status).toBe(401);
    h.user = safe(presenter);
    for (const headers of [{ origin: 'https://evil.test' }, { origin: 'http://localhost', 'sec-fetch-site': 'cross-site' }, { host: 'evil.test' }] as Record<string, string>[])
        expect((await capture.POST(req('/api/assumptions/capture', data(), headers))).status).toBe(403);
    const missing = req('/api/assumptions/capture', data());
    missing.headers.delete('origin');
    expect((await capture.POST(missing)).status).toBe(403);
    expect(await f.db.auditLog.count()).toBe(0);
});
it('bounded, strict capture and private chronological export', async () => { const v = data(); expect((await capture.POST(req('/api/assumptions/capture', v))).status).toBe(200); expect((await capture.POST(req('/api/assumptions/capture', v))).status).toBe(200); expect((await capture.POST(req('/api/assumptions/capture', { ...v, note: 'other' }))).status).toBe(409); expect((await capture.POST(req('/api/assumptions/capture', { ...data(), actorId: 'forged' }))).status).toBe(400); expect((await capture.POST(req('/api/assumptions/capture', { ...data(), note: 'x'.repeat(17000) }))).status).toBe(400); const csv = await download.GET(); expect(csv.status).toBe(200); expect(csv.headers.get('cache-control')).toBe('private, no-store'); expect(await csv.text()).toContain('private finding'); expect(await f.db.assumptionFeedback.count()).toBe(1); expect(await f.db.auditLog.count()).toBe(1); });
it('catalog never leaks findings to ordinary roles; presenter sees escaped append-only history', async () => { await capture.POST(req('/api/assumptions/capture', data())); const officer = renderToStaticMarkup(await Page()); expect(officer).toContain('&lt;script&gt;private finding'); expect(officer).not.toContain('<script>private finding'); h.user = { ...safe(presenter), role: 'STUDENT' }; const student = renderToStaticMarkup(await Page()); expect(student).toContain('A18:'); expect(student).not.toContain('private finding'); expect(student).not.toContain('Chronological history'); expect(student).not.toContain('Capture A'); });
it('DB errors are explicit failures, never successful empty CSV or saved receipts', async () => { h.failed = true; expect((await capture.POST(req('/api/assumptions/capture', data()))).status).toBe(503); const csv = await download.GET(); expect(csv.status).toBe(503); expect(csv.headers.get('content-type')).not.toContain('text/csv'); const html = renderToStaticMarkup(await Page()); expect(html).toContain('Findings unavailable'); expect(html).not.toContain('private database detail'); expect(html).not.toContain('0 / 18'); });
it('reset requires local origin, ADMIN, flags and typed exact confirmation', async () => {
    h.user = safe(admin);
    for (const headers of [{ origin: 'https://evil.test' }, { 'sec-fetch-site': 'cross-site' }] as Record<string, string>[])
        expect((await reset.POST(req('/api/demo/reset', { confirmation: 'RESET SAMPLE DATA' }, headers))).status).toBe(403);
    expect((await reset.POST(req('/api/demo/reset', { confirmation: 'bad' }))).status).toBe(400);
    expect((await reset.POST(req('/api/demo/reset', { confirmation: 'RESET SAMPLE DATA', dbPath: 'dev.db' }))).status).toBe(400);
    vi.stubEnv('M8_DEMO_RESET_ENABLED', 'false');
    expect((await reset.POST(req('/api/demo/reset', { confirmation: 'RESET SAMPLE DATA' }))).status).toBe(404);
    expect(await f.db.auditLog.count()).toBe(0);
    expect(await f.db.timetableEntry.count()).toBe(10);
});
it('no GET reset or capture handler is exported', () => { expect('GET' in reset).toBe(false); expect('GET' in capture).toBe(false); });
