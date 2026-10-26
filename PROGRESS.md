# PROGRESS.md
(The agent appends entries here at the end of every task. This file is the agent's memory between sessions.)

## Status
- Current milestone: M1
- Last verified commit: M1-T2
- Demo-ready: no

## Log
## 2026-10-26 M1-T2 Deterministic Seed Data and Password Hashing
- Done: Created deterministic pure seed data conforming to spec §10, implemented scrypt password hashing and verification with timingSafeEqual, added idempotent prisma/seed.ts script, and comprehensive seed-check assertions.
- Files changed: package.json, .env.example, src/server/password.ts, src/server/__tests__/password.test.ts, src/domain/seedData.ts, prisma/seed.ts, src/domain/__tests__/seed-check.test.ts, DECISIONS.md, PROGRESS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 26 tests passed; seed:check: 6 tests passed; seed twice idempotent)
- Decisions: Used sessionsPerWeek = 3 and sessionLength = 1 as proxy for assumption A15 until meeting; used Node built-in crypto (scrypt) with timing-safe comparison; added tsx dev dependency for seed script execution.
- Known problems: Auth sessions and role guard helpers not yet implemented (scheduled for M1-T3).
- Next suggested task: M1-T3

## 2026-10-26 M1-T1b Domain Model Field & Relation Patches
- Done: Added studentGroupId to User with StudentGroup relation, reportedBy to Issue, requestedBy and decisionNote to RescheduleRequest, semester to Submission; added Day and TimeHHMM schemas with isStartBeforeEnd helper and comprehensive boundary tests.
- Files changed: prisma/schema.prisma, src/domain/types.ts, src/domain/__tests__/types.test.ts, PROTOTYPE_SPEC.md, DECISIONS.md, PROGRESS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 17 tests passed; seed:check: 1 test passed)
- Decisions: Added relations with explicit indexes to support student attendance eligibility, role-based issue tracking, and reschedule workflows; added TimeHHMMSchema with strict 24-hour HH:MM validation and pure start-before-end comparator.
- Known problems: Seed script not yet written (scheduled for M1-T2).
- Next suggested task: M1-T2

## 2026-10-26 M1-T1 Domain Model Schema & Types
- Done: Replaced SystemMeta with full domain model Prisma schema, created domain_model migration, created src/domain/types.ts with Zod schemas and facilities JSON helpers, and added unit tests.
- Files changed: prisma/schema.prisma, src/domain/types.ts, src/domain/__tests__/types.test.ts, PROGRESS.md, DECISIONS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 14 tests passed; seed:check: 1 test passed)
- Decisions: Modeled relations and SQLite rules storing enums as strings and list fields as JSON strings with parser/serializer helpers; indexed all foreign keys; enforced AttendanceRecord unique constraint on (sessionId, studentId).
- Known problems: Seed script not yet written (scheduled for M1-T2).
- Next suggested task: M1-T2

## 2026-10-26 M0-T2 Prototype Banner Component & Root Integration
- Done: Added PrototypeBanner component with visible styling to root layout across all pages, updated DECISIONS.md and PROGRESS.md documentation.
- Files changed: src/components/PrototypeBanner.tsx, src/app/layout.tsx, DECISIONS.md, PROGRESS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 2 tests passed; seed:check: 1 test passed)
- Decisions: Maintained ESLint via next lint for prototype; placed high-contrast amber banner in root layout above all page content.
- Known problems: Seed data and full domain models are not yet implemented (scheduled for M1).
- Next suggested task: M1-T1

## 2026-10-26 M0-T1 Foundation Stack & Verification Pipeline
- Done: Initialized Next.js App Router, strict TypeScript, Tailwind CSS, Vitest, ESLint, Prisma SQLite, and the npm run verify pipeline.
- Files changed: .clinerules, .env.example, .eslintrc.json, .gitignore, DECISIONS.md, PROGRESS.md, next-env.d.ts, next.config.ts, package-lock.json, package.json, postcss.config.mjs, prisma/migrations/20261026085251_init/migration.sql, prisma/migrations/migration_lock.toml, prisma/schema.prisma, src/app/globals.css, src/app/layout.tsx, src/app/page.tsx, src/domain/__tests__/baseline.test.ts, src/domain/__tests__/seed-check.test.ts, tailwind.config.ts, tsconfig.json, vitest.config.ts
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 2 tests passed; seed:check: 1 test passed; tests in src/domain/__tests__)
- Decisions: Initialized Prisma with SQLite dev.db and a placeholder SystemMeta model until M1-T1; Vitest alias @ mapped to ./src; seed:check stubbed for M1-T2 seed integrity.
- Known problems: Seed data and full domain models are not yet implemented (scheduled for M1).
- Next suggested task: M0-T2
