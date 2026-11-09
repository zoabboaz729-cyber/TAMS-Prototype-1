import { it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { DEMO_STEPS } from '../demoScript';
import { ASSUMPTIONS } from '../assumptions';
import { resetPolicy, ResetInput } from '../demoResetPolicy';
it('seven stages with actual screen links, questions and recoveries', () => {
    expect(DEMO_STEPS).toHaveLength(7);
    for (const s of DEMO_STEPS) {
        expect(s.question.length).toBeGreaterThan(10);
        expect(s.recovery.length).toBeGreaterThan(20);
        for (const p of s.paths) {
            expect(p).not.toBe('/officer/generate');
            expect(existsSync(`src/app${p}/page.tsx`)).toBe(true);
        }
        for (const a of s.assumptions)
            expect(ASSUMPTIONS.some(v => v.key === a)).toBe(true);
    }
    expect(new Set(DEMO_STEPS.flatMap(s => [...s.assumptions])).size).toBe(18);
});
const env = { DEMO_MODE: 'true', NODE_ENV: 'development', M8_DEMO_RESET_ENABLED: 'true', DATABASE_URL: 'file:./m7-demo-m8-meeting-01.db', M8_DEMO_RESET_DATABASE_URL: 'file:./m7-demo-m8-meeting-01.db' };
it('explicit reset gates and exact confirmation', () => {
    expect(resetPolicy(env)).toBe(true);
    expect(ResetInput.safeParse({ confirmation: 'RESET SAMPLE DATA' }).success).toBe(true);
    expect(ResetInput.safeParse({ confirmation: 'reset sample data' }).success).toBe(false);
    expect(ResetInput.safeParse({ confirmation: 'RESET SAMPLE DATA', dbPath: 'dev.db' }).success).toBe(false);
    for (const v of [{ NODE_ENV: 'production' }, { DEMO_MODE: 'TRUE' }, { M8_DEMO_RESET_ENABLED: undefined }, { DATABASE_URL: undefined }, { M8_DEMO_RESET_DATABASE_URL: 'file:./dev.db' }])
        expect(resetPolicy({ ...env, ...v })).toBe(false);
});
it.each(['file:./dev.db', 'file:./walkthrough.db', 'file:../m8-demo-other.db', 'file:/tmp/m8-demo-other.db', 'file:./m8-demo-other.db?x=1', 'postgres://x', 'file:./m8-demo-../dev.db', 'file:./m7-demo-ordinary.db'])('refuses %s even when targets match', DATABASE_URL => expect(resetPolicy({ ...env, DATABASE_URL, M8_DEMO_RESET_DATABASE_URL: DATABASE_URL })).toBe(false));
