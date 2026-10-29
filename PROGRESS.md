# PROGRESS.md
(The agent appends entries here at the end of every task. This file is the agent's memory between sessions.)

## Status
- Current milestone: M1
- Last verified commit: M1-T3a
- Demo-ready: no

## Log
## 2026-10-26 M1-T3b Login Page, Logout, and User Bar
- Done: Created /login page (email+password form, Zod error codes, redirect if already authenticated), POST /api/auth/login route (Zod validation, config-failure vs. auth-failure distinction, calls authenticate() then startSession() only on success, same-origin redirect only), POST /api/auth/logout route (calls endSession(), redirects to /login), and server-rendered user bar in root layout using getCurrentUser() — user name and role from DB, sign-out POST form.
- Files changed: src/app/login/page.tsx, src/app/api/auth/login/route.ts, src/app/api/auth/logout/route.ts, src/app/layout.tsx, PROGRESS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 43 tests passed across 5 files; seed:check: 9 tests passed)
- Decisions: Error codes in query param are allowlisted (`invalid_credentials`, `config`, `bad_request`); arbitrary query text is never rendered. Config failures (SESSION_SECRET missing/short) redirect to `/login?e=config` rather than `/login?e=invalid_credentials` so operators can distinguish a broken deployment from a user typo. Logout is POST-only to prevent CSRF-style sign-out via a link. Used `<Link>` from next/link for internal navigation to pass ESLint `@next/next/no-html-link-for-pages` rule.
- Known problems: Route handlers POST /api/auth/login and POST /api/auth/logout use Next.js cookies() which requires the DB and SESSION_SECRET to be present; unit tests for route handlers cannot be added within the 5-file limit (route handlers depend on next/server mocks not available in vitest without extra setup). Manual verification steps are documented in the task report artifact.
- Next suggested task: M1-T3c (role-based home pages and route guard helper)
## 2026-10-26 M1-T3a Signed Session Tokens and Auth Helpers
- Done: Implemented pure createSessionToken/verifySessionToken (HMAC-SHA256, base64url, Zod validation), 14 unit tests, shared PrismaClient (globalThis hot-reload pattern), and server auth helpers (getSessionSecret, startSession, endSession, getCurrentUser, authenticate). Updated .env.example with SESSION_SECRET.
- Files changed: src/server/session.ts, src/server/__tests__/session.test.ts, src/server/db.ts, src/server/auth.ts, .env.example, PROGRESS.md, DECISIONS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 43 tests passed across 5 files; seed:check: 9 tests passed)
- Decisions: Signed-cookie sessions (custom HMAC) instead of Auth.js — see DECISIONS.md; no login lockout in prototype; 8-hour sessions (SESSION_DURATION_MS).
- Known problems: No login page yet (M1-T3b or later). getCurrentUser and authenticate not directly unit-testable without DB mock — covered by integration tests later.
- Next suggested task: M1-T3b (login/logout page and route handler)
## 2026-10-26 M1-T2b Refine Planted Conflicts to Single-Violation
- Done: Corrected planted seed conflicts to isolate single violation types, added production seed guard, and expanded seed-check assertions with pure time overlap validation.
- Files changed: src/domain/seedData.ts, prisma/seed.ts, src/domain/__tests__/seed-check.test.ts, DECISIONS.md, PROGRESS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 29 tests passed; seed:check: 9 tests passed; seed run twice idempotent)
- Decisions: Shifted Lecturer A's unavailability away from MON 08:00-09:00 to MON 15:00-17:00; moved entry-planted-lecturer-2 to CR1 (capacity 60) to eliminate capacity shortage while keeping lecturer clash; added NODE_ENV=production guard to seed.ts.
- Known problems: Auth sessions and role guard helpers not yet implemented (scheduled for M1-T3).
- Next suggested task: M1-T3
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

## 2026-10-29 M1-T3b-fix Harden login error codes and fix role label
- Done: Both fixes verified already present at HEAD d07059f (commit "M1-T3b-fix: harden login error codes and fix role label"), so no source edits were required: (1) src/app/login/page.tsx uses `Object.hasOwn(ERROR_MESSAGES, rawCode)` instead of `rawCode in ERROR_MESSAGES` — inherited properties (e.g. "toString"), arrays, and unknown codes are ignored; only invalid_credentials, config, bad_request render messages. tsconfig left unchanged (Object.hasOwn is available with target ES2022; no fallback used). (2) src/app/layout.tsx role label map key changed from HOD to APPROVER, label kept "Head of Department"; all six roles from src/domain/types.ts (ADMIN, OFFICER, DEPT_REP, APPROVER, LECTURER, STUDENT) have labels; role enum unchanged.
- Files changed: none in src (fixes already committed in d07059f: src/app/login/page.tsx, src/app/layout.tsx); PROGRESS.md updated with this entry only.
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint ✔ no ESLint warnings or errors; vitest 43 tests passed across 5 files; seed:check 9 tests passed.
- Decisions: no test added — the 3-file limit (login page, layout, PROGRESS.md) leaves no slot for a test file, and no source changed since both fixes were already committed.
- Known problems: none from this task.
- Next suggested task: M1-T3c (role-based home pages and route guard helper)

## 2026-10-29 M1-T3b2 Harden auth role validation and email normalisation
- Done: Added src/server/email.ts exporting normaliseEmail() (trim + lowercase) with 4 unit tests; authenticate() now normalises the email before the DB lookup while keeping the dummy verifyPassword() call for unknown users and dropping the wrong (ASSUMPTION-3) tag; getCurrentUser() and authenticate() now validate the role with UserRoleSchema.safeParse instead of `as SafeUser` casts (returning null on invalid role); catch blocks log "[auth] getCurrentUser failed:" / "[auth] authenticate failed:" plus the error message only via console.error, never the token, password, cookie value, or full error object; DECISIONS.md records that signed stateless cookies cannot be revoked before expiry (logout deletes the cookie only; revisit with a session table at M9).
- Files changed: src/server/email.ts (new), src/server/__tests__/email.test.ts (new), src/server/auth.ts, DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint ✔ no ESLint warnings or errors; vitest 47 tests passed across 6 files; seed:check 9 tests passed.
- Decisions: an invalid role stored for a user is treated as an unknown user (return null); non-Error catch values are stringified safely so no secrets are logged.
- Known problems: none from this task.
- Next suggested task: M1-T3c (role-based home pages and route guard helper)

## 2026-10-29 M1-T3c-1 Pure permission matrix
- Done: Added src/domain/permissions.ts (ACTIONS, SCOPES, Action/Scope types, explicit PERMISSION_SCOPE lookup table, permissionScope, Actor, Resource, deny-by-default canAct, allowedActions — pure domain logic per PROTOTYPE_SPEC §8) and src/domain/__tests__/permissions.test.ts (literal 102-cell role × action table, completeness check, canAct allow/deny cases, unknown role/action runtime guards).
- Files changed: src/domain/permissions.ts (new), src/domain/__tests__/permissions.test.ts (new), PROGRESS.md, DECISIONS.md
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint no ESLint warnings or errors; vitest 72 tests passed across 7 files (25 new permission tests); seed:check 9 tests passed.
- Decisions: matrix is deny-by-default and scope-based; Record<UserRole, Record<Action, Scope>> makes the table compile-time complete with no defaults or fall-through; ADMIN only has MANAGE_USERS (plus view rights) in the prototype; unknown roles/actions passed at runtime return NONE/false, never throw.
- Known problems: none from this task.
- Next suggested task: M1-T3c route guard helper and role-based menus built with allowedActions()
