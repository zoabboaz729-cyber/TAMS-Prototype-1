import { it, expect } from 'vitest';
import { m8Fixture, presenter, admin } from './m8Fixture';
import { demoReadiness } from '../demoReadiness';
import type { PrismaClient } from '@prisma/client';
it('readiness is guarded, fresh seed is not globally ready, and no secrets or paths leak', async () => {
    const f = await m8Fixture();
    try {
        const env = { ...f.env, DEMO_MODE: 'true', NODE_ENV: 'test', M8_DEMO_RESET_ENABLED: 'true', M8_DEMO_RESET_DATABASE_URL: f.url, ATTENDANCE_TOKEN_SECRET: 'private-secret-do-not-leak', SESSION_SECRET: 'private-session-do-not-leak' };
        const checks = await demoReadiness(f.db, presenter, env);
        expect(checks).toHaveLength(9);
        expect(checks.find(c => c.label === 'Database')?.state).toBe('READY');
        expect(checks.find(c => c.label === 'Draft')?.state).toBe('READY');
        expect(checks.find(c => c.label === 'Published timetable')?.state).toBe('NOT_READY');
        expect(checks.find(c => c.label === 'QR demonstration')?.state).toBe('NOT_READY');
        expect(checks.find(c => c.label === 'Reset permission')?.state).toBe('BLOCKED');
        expect((await demoReadiness(f.db, admin, env)).find(c => c.label === 'Reset permission')?.state).toBe('READY');
        expect(JSON.stringify(checks)).not.toContain(f.url);
        expect(JSON.stringify(checks)).not.toContain('private-secret');
        for (const actor of [null, { ...presenter, role: 'STUDENT' as const }])
            await expect(demoReadiness(f.db, actor, env)).rejects.toThrow('FORBIDDEN');
    }
    finally {
        await f.close();
    }
}, 60000);
it('database failure is ERROR, never invented zero counts', async () => { const broken = { user: { findMany: () => { throw new Error('private db error'); } } } as unknown as PrismaClient; const checks = await demoReadiness(broken, presenter); expect(checks).toEqual([{ label: 'Database', state: 'ERROR', message: 'Data unavailable. Retry or ask the demo operator to check the database; readiness is unknown.' }]); });
