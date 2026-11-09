import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
it('pre-M8 upgrade preserves every original table field and legacy feedback with null provenance', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tams-m8-upgrade-')), url = `file:${path.join(dir, 'upgrade.db')}`, m = path.join(dir, 'migrations');
    mkdirSync(m);
    copyFileSync('prisma/schema.prisma', path.join(dir, 'schema.prisma'));
    copyFileSync('prisma/migrations/migration_lock.toml', path.join(m, 'migration_lock.toml'));
    const names = readdirSync('prisma/migrations').filter(n => n !== 'migration_lock.toml');
    const copy = (n: string) => { mkdirSync(path.join(m, n)); copyFileSync(path.join('prisma/migrations', n, 'migration.sql'), path.join(m, n, 'migration.sql')); };
    names.filter(n => !n.includes('_m8_')).forEach(copy);
    const env = { ...process.env, DATABASE_URL: url, RUST_LOG: 'info', DEMO_PASSWORD: 'isolated-synthetic-only' };
    const deploy = () => execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', path.join(dir, 'schema.prisma')], { env, stdio: 'pipe' });
    deploy();
    const db = new PrismaClient({ datasources: { db: { url } } });
    try {
        execFileSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], { env, stdio: 'pipe' });
        await db.$executeRawUnsafe(`INSERT INTO AssumptionFeedback(id,assumptionKey,verdict,note,at) VALUES('legacy','A1','MODIFY','old statement','2026-11-01T00:00:00.000Z')`);
        const tables = await db.$queryRawUnsafe<{
            name: string;
        }[]>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'");
        const before = new Map<string, Record<string, unknown>[]>();
        for (const { name } of tables)
            before.set(name, await db.$queryRawUnsafe(`SELECT * FROM "${name}" ORDER BY rowid`));
        await db.$disconnect();
        names.filter(n => n.includes('_m8_')).forEach(copy);
        deploy();
        for (const [name, old] of before) {
            const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${name}" ORDER BY rowid`);
            expect(rows).toHaveLength(old.length);
            old.forEach((r, i) => Object.entries(r).forEach(([k, v]) => expect(rows[i][k]).toEqual(v)));
        }
        expect(await db.assumptionFeedback.findUnique({ where: { id: 'legacy' } })).toMatchObject({ meetingLabel: null, sourceRole: null, recordedByRole: null, submissionKey: null });
        expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
    }
    finally {
        await db.$disconnect();
        rmSync(dir, { recursive: true, force: true });
    }
}, 60000);
