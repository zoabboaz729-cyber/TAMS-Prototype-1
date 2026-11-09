import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
export async function m8Fixture() {
    const name = `m7-demo-m8-test-${randomUUID()}.db`, file = path.resolve('prisma', name), url = `file:./${name}`;
    const env = { ...process.env, DATABASE_URL: url, DEMO_PASSWORD: 'isolated-synthetic-only' };
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env, stdio: 'pipe' });
    execFileSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], { env, stdio: 'pipe' });
    const db = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    return { db, url, file, env, async close() {
            await db.$disconnect();
            for (const suffix of ['', '-journal', '-wal', '-shm'])
                try {
                    unlinkSync(file + suffix);
                }
                catch { /* isolated fixture may have no sidecars */ }
        } };
}
export const presenter = { id: 'user-officer', role: 'OFFICER' as const, departmentId: null, studentGroupId: null };
export const admin = { ...presenter, id: 'user-admin', role: 'ADMIN' as const };
