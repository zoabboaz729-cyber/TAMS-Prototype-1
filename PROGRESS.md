# PROGRESS.md
Entries are listed newest-last; the Status block below is authoritative.
(The agent appends entries here at the end of every task. This file is the agent's memory between sessions.)

## Status
- Current milestone: M2
- Last verified code commit: 99ef542 (later branch commits are documentation-only)
- Demo-ready: no

## Log
## 2026-10-26 M0-T1 Foundation Stack & Verification Pipeline
- Done: Initialized Next.js App Router, strict TypeScript, Tailwind CSS, Vitest, ESLint, Prisma SQLite, and the npm run verify pipeline.
- Files changed: .clinerules, .env.example, .eslintrc.json, .gitignore, DECISIONS.md, PROGRESS.md, next-env.d.ts, next.config.ts, package-lock.json, package.json, postcss.config.mjs, prisma/migrations/20261026085251_init/migration.sql, prisma/migrations/migration_lock.toml, prisma/schema.prisma, src/app/globals.css, src/app/layout.tsx, src/app/page.tsx, src/domain/__tests__/baseline.test.ts, src/domain/__tests__/seed-check.test.ts, tailwind.config.ts, tsconfig.json, vitest.config.ts
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 2 tests passed; seed:check: 1 test passed; tests in src/domain/__tests__)
- Decisions: Initialized Prisma with SQLite dev.db and a placeholder SystemMeta model until M1-T1; Vitest alias @ mapped to ./src; seed:check stubbed for M1-T2 seed integrity.
- Known problems: Seed data and full domain models are not yet implemented (scheduled for M1).
- Next suggested task: M0-T2

## 2026-10-26 M0-T2 Prototype Banner Component & Root Integration
- Done: Added PrototypeBanner component with visible styling to root layout across all pages, updated DECISIONS.md and PROGRESS.md documentation.
- Files changed: src/components/PrototypeBanner.tsx, src/app/layout.tsx, DECISIONS.md, PROGRESS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 2 tests passed; seed:check: 1 test passed)
- Decisions: Maintained ESLint via next lint for prototype; placed high-contrast amber banner in root layout above all page content.
- Known problems: Seed data and full domain models are not yet implemented (scheduled for M1).
- Next suggested task: M1-T1

## 2026-10-26 M1-T1 Domain Model Schema & Types
- Done: Replaced SystemMeta with full domain model Prisma schema, created domain_model migration, created src/domain/types.ts with Zod schemas and facilities JSON helpers, and added unit tests.
- Files changed: prisma/schema.prisma, src/domain/types.ts, src/domain/__tests__/types.test.ts, PROGRESS.md, DECISIONS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 14 tests passed; seed:check: 1 test passed)
- Decisions: Modeled relations and SQLite rules storing enums as strings and list fields as JSON strings with parser/serializer helpers; indexed all foreign keys; enforced AttendanceRecord unique constraint on (sessionId, studentId).
- Known problems: Seed script not yet written (scheduled for M1-T2).
- Next suggested task: M1-T2

## 2026-10-26 M1-T1b Domain Model Field & Relation Patches
- Done: Added studentGroupId to User with StudentGroup relation, reportedBy to Issue, requestedBy and decisionNote to RescheduleRequest, semester to Submission; added Day and TimeHHMM schemas with isStartBeforeEnd helper and comprehensive boundary tests.
- Files changed: prisma/schema.prisma, src/domain/types.ts, src/domain/__tests__/types.test.ts, PROTOTYPE_SPEC.md, DECISIONS.md, PROGRESS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 17 tests passed; seed:check: 1 test passed)
- Decisions: Added relations with explicit indexes to support student attendance eligibility, role-based issue tracking, and reschedule workflows; added TimeHHMMSchema with strict 24-hour HH:MM validation and pure start-before-end comparator.
- Known problems: Seed script not yet written (scheduled for M1-T2).
- Next suggested task: M1-T2

## 2026-10-26 M1-T2 Deterministic Seed Data and Password Hashing
- Done: Created deterministic pure seed data conforming to spec §10, implemented scrypt password hashing and verification with timingSafeEqual, added idempotent prisma/seed.ts script, and comprehensive seed-check assertions.
- Files changed: package.json, .env.example, src/server/password.ts, src/server/__tests__/password.test.ts, src/domain/seedData.ts, prisma/seed.ts, src/domain/__tests__/seed-check.test.ts, DECISIONS.md, PROGRESS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 26 tests passed; seed:check: 6 tests passed; seed twice idempotent)
- Decisions: Used sessionsPerWeek = 3 and sessionLength = 1 as proxy for assumption A15 until meeting; used Node built-in crypto (scrypt) with timing-safe comparison; added tsx dev dependency for seed script execution.
- Known problems: Auth sessions and role guard helpers not yet implemented (scheduled for M1-T3).
- Next suggested task: M1-T3

## 2026-10-26 M1-T2b Refine Planted Conflicts to Single-Violation
- Done: Corrected planted seed conflicts to isolate single violation types, added production seed guard, and expanded seed-check assertions with pure time overlap validation.
- Files changed: src/domain/seedData.ts, prisma/seed.ts, src/domain/__tests__/seed-check.test.ts, DECISIONS.md, PROGRESS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 29 tests passed; seed:check: 9 tests passed; seed run twice idempotent)
- Decisions: Shifted Lecturer A's unavailability away from MON 08:00-09:00 to MON 15:00-17:00; moved entry-planted-lecturer-2 to CR1 (capacity 60) to eliminate capacity shortage while keeping lecturer clash; added NODE_ENV=production guard to seed.ts.
- Known problems: Auth sessions and role guard helpers not yet implemented (scheduled for M1-T3).
- Next suggested task: M1-T3

## 2026-10-26 M1-T3a Signed Session Tokens and Auth Helpers
- Done: Implemented pure createSessionToken/verifySessionToken (HMAC-SHA256, base64url, Zod validation), 14 unit tests, shared PrismaClient (globalThis hot-reload pattern), and server auth helpers (getSessionSecret, startSession, endSession, getCurrentUser, authenticate). Updated .env.example with SESSION_SECRET.
- Files changed: src/server/session.ts, src/server/__tests__/session.test.ts, src/server/db.ts, src/server/auth.ts, .env.example, PROGRESS.md, DECISIONS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 43 tests passed across 5 files; seed:check: 9 tests passed)
- Decisions: Signed-cookie sessions (custom HMAC) instead of Auth.js — see DECISIONS.md; no login lockout in prototype; 8-hour sessions (SESSION_DURATION_MS).
- Known problems: No login page yet (M1-T3b or later). getCurrentUser and authenticate are not directly unit-testable without a DB mock; no database-backed integration tests for these helpers are recorded in this log.
- Next suggested task: M1-T3b (login/logout page and route handler)

## 2026-10-26 M1-T3b Login Page, Logout, and User Bar
- Done: Created /login page (email+password form, Zod error codes, redirect if already authenticated), POST /api/auth/login route (Zod validation, config-failure vs. auth-failure distinction, calls authenticate() then startSession() only on success, same-origin redirect only), POST /api/auth/logout route (calls endSession(), redirects to /login), and server-rendered user bar in root layout using getCurrentUser() — user name and role from DB, sign-out POST form.
- Files changed: src/app/login/page.tsx, src/app/api/auth/login/route.ts, src/app/api/auth/logout/route.ts, src/app/layout.tsx, PROGRESS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 43 tests passed across 5 files; seed:check: 9 tests passed)
- Decisions: Error codes in query param are allowlisted (`invalid_credentials`, `config`, `bad_request`); arbitrary query text is never rendered. Config failures (SESSION_SECRET missing/short) redirect to `/login?e=config` rather than `/login?e=invalid_credentials` so operators can distinguish a broken deployment from a user typo. Logout is POST-only to prevent CSRF-style sign-out via a link. Used `<Link>` from next/link for internal navigation to pass ESLint `@next/next/no-html-link-for-pages` rule.
- Known problems: Route handlers POST /api/auth/login and POST /api/auth/logout use Next.js cookies() which requires the DB and SESSION_SECRET to be present; unit tests for route handlers cannot be added within the 5-file limit (route handlers depend on next/server mocks not available in vitest without extra setup). Manual verification steps are documented in the task report artifact.
- Next suggested task: M1-T3c (role-based home pages and route guard helper)

## 2026-10-29 M1-T3b-fix Harden login error codes and fix role label
- Done: Both fixes verified already present at HEAD fe22c47 (commit "M1-T3b-fix: harden login error codes and fix role label"), so no source edits were required: (1) src/app/login/page.tsx uses `Object.hasOwn(ERROR_MESSAGES, rawCode)` instead of `rawCode in ERROR_MESSAGES` — inherited properties (e.g. "toString"), arrays, and unknown codes are ignored; only invalid_credentials, config, bad_request render messages. tsconfig left unchanged (Object.hasOwn is available with target ES2022; no fallback used). (2) src/app/layout.tsx role label map key changed from HOD to APPROVER, label kept "Head of Department"; all six roles from src/domain/types.ts (ADMIN, OFFICER, DEPT_REP, APPROVER, LECTURER, STUDENT) have labels; role enum unchanged.
- Files changed: none in src (fixes already committed in fe22c47: src/app/login/page.tsx, src/app/layout.tsx); PROGRESS.md updated with this entry only.
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

## 2026-10-29 M1-T3c-2 Access decision and server guards
- Done: Added src/domain/access.ts (decideAccess: actor null → UNAUTHENTICATED, canAct → ALLOW, else FORBIDDEN; pure, never throws), src/domain/__tests__/access.test.ts (11 tests covering null actor, officer ALLOW, student FORBIDDEN, dept rep own/other/no resource, lecturer own/other class, unknown runtime-cast role), src/server/guards.ts (requireUser, requireAction, authorizeApi; redirect never inside try/catch; JSON bodies contain only the error key), and src/app/forbidden/page.tsx (server page, no requireAction). Updated AGENTS.md (layout not a security boundary; table-driven test file line exemption) and DECISIONS.md (OWN_CLASSES compares User id — pass teaching.lecturer.userId; no middleware due to Edge runtime).
- Files changed: src/domain/access.ts (new), src/domain/__tests__/access.test.ts (new), src/server/guards.ts (new), src/app/forbidden/page.tsx (new), AGENTS.md, DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint ✔ no ESLint warnings or errors; vitest 83 tests passed across 8 files; seed:check 9 tests passed.
- Decisions: (a) OWN_CLASSES compares `resource.ownerUserId` with `actor.id` (the User id), so callers pass `teaching.lecturer.userId`, not the Lecturer row id; (b) no Next.js middleware — Edge runtime lacks Prisma and Node crypto, so guards run per page/route handler/server action in the Node runtime.
- Known problems: none from this task; home pages, menus, and demo switcher intentionally not built (M1-T3c-4).
- Next suggested task: M1-T3c-4 role-based home pages using the new guards.

## 2026-11-01 M1-T3c-3 Same-origin check, email trim, deny-by-default guards
- Done: Added pure same-origin request check (Origin header vs Host including port, Sec-Fetch-Site fallback, deny by default, never throws) with 12 unit tests; extracted shared LoginSchema out of the login route (email trimmed before validation via z.string().trim().email(), password untrimmed z.string().min(1)) plus a normaliseLoginEmail helper applying normaliseEmail, with 6 unit tests; applied the check to the login route (303 /login?e=bad_request before anything else, shared schema, all other behaviour unchanged) and logout route (403 { error: "forbidden" }, cookie not cleared on failure); changed requireAction and authorizeApi to deny-by-default (decision.status !== "ALLOW").
- Files changed: src/server/origin.ts (new), src/server/__tests__/origin.test.ts (new), src/server/loginSchema.ts (new), src/server/__tests__/loginSchema.test.ts (new), src/app/api/auth/login/route.ts, src/app/api/auth/logout/route.ts, src/server/guards.ts, DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint 0 warnings/errors; vitest 101 tests passed across 10 files (18 new); seed:check 9 tests passed.
- Decisions: recorded in DECISIONS.md — (a) no login rate limiting in the prototype; (b) all demo accounts share one password and data is synthetic, never deploy publicly; (c) cross-site check uses the Origin header with a Sec-Fetch-Site fallback instead of CSRF tokens.
- Known problems: none from this task.
- Next suggested task: M1-T3c-4 role-based home pages using the new guards.

## 2026-11-01 M1-T3c-4 Role-based menus and guarded demo account switch
- Done: Added role-based navigation menus derived from the permission matrix (MENU_ITEMS, all built: false; menuForRole returns items whose permissionScope is not "NONE" in list order; unknown roles return []) plus the guarded POST /api/demo/switch demo-account switch with three protections (demo-mode gate → 404 not_found, same-origin check → 403 forbidden, demo-account-only sessioning with generic /login?e=bad_request for unknown ids and non-demo accounts); updated .env.example with DEMO_MODE=false and recorded the design in DECISIONS.md.
- Files changed: src/domain/menu.ts (new), src/domain/__tests__/menu.test.ts (new), src/server/demoMode.ts (new), src/server/__tests__/demoMode.test.ts (new), src/app/api/demo/switch/route.ts (new), .env.example, DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint 0 warnings/errors; vitest 133 tests passed across 12 files (32 new); seed:check 9 tests passed.
- Decisions: menus are derived from PERMISSION_SCOPE so the UI stays consistent with enforced authorization (UI is never a security boundary); PUBLISH_TIMETABLE and MANAGE_SHARED_VENUES deliberately have no menu entries; built flags flip to true as pages are delivered; demo switch is production-gated, same-origin-gated, and enumeration-resistant; no password is read or logged and nothing is logged.
- Known problems: no pages/components consume the menu yet (next task); demo accounts share one password (documented in DECISIONS.md).
- Next suggested task: M1-T3c role-based home pages rendering menuForRole.

## 2026-11-01 M1-T3c-5 Role home page, demo switcher, and guarded placeholders
- Done: Added async DemoSwitcher server component that renders nothing unless DEMO_MODE is "true" and NODE_ENV is not production, lists only demo accounts (id, name, email, role, never the hash) as one POST form per account with a hidden userId, and uses no client JavaScript; wired it next to UserBar in the root header with a single getCurrentUser() call; replaced the home page with a public role-menu page (signed-out welcome + "Prototype built on assumptions; please correct us" + Sign in link; signed-in menuForRole list in order with built items as links and unbuilt items greyed "Coming soon"); added guard-probe placeholders /officer (requireAction EDIT_DRAFT) and /admin (requireAction MANAGE_USERS); and set /forbidden to min-h-[calc(100vh-8rem)].
- Files changed: src/components/DemoSwitcher.tsx (new), src/app/layout.tsx, src/app/page.tsx, src/app/officer/page.tsx (new), src/app/admin/page.tsx (new), src/app/forbidden/page.tsx, DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint no ESLint warnings or errors; vitest 133 tests passed across 12 files; seed:check 9 tests passed. `npm run build`: succeeded; all pages render dynamically on demand as expected.
- Decisions: /officer and /admin are guard-probe placeholders that become real dashboards in later milestones; the demo switcher renders only when DEMO_MODE === "true" and NODE_ENV !== "production" (never in production); the home page never calls requireAction and renders only menuForRole(user.role) items.
- Known problems: none.
- Next suggested task: deliver the first built menu page (flip a built: false flag to true).

## 2026-11-01 M1-T3c-6 Cleanup before merging M1
- Done: Moved `cookies()` outside try/catch in `getCurrentUser()` (with comment); added `src/domain/roles.ts` with `ROLE_LABEL` + `roleLabel()` (single source of truth, `Object.hasOwn`-based, never throws); removed duplicate maps from layout.tsx, page.tsx, DemoSwitcher.tsx; added red "DEMO MODE ON" badge inside `<summary>` of DemoSwitcher and removed the duplicate in-body label; added `GET` (404 not_found) to /api/demo/switch route and fixed header comment to "six ordered checks (a to f)"; recorded decisions in DECISIONS.md.
- Files changed: src/domain/roles.ts (new), src/domain/__tests__/roles.test.ts (new), src/server/auth.ts, src/app/api/demo/switch/route.ts, src/components/DemoSwitcher.tsx, src/app/layout.tsx, src/app/page.tsx, DECISIONS.md, PROGRESS.md
- Verify: PASS (typecheck 0 errors; lint 0 warnings/errors; vitest 138 tests passed across 13 files; seed:check 9 tests passed)
- Build: PASS (next build succeeded, zero `[auth]` lines in output)
- Decisions: cookies() outside try/catch to avoid swallowing Next.js dynamic-rendering signals; role labels single-sourced from src/domain/roles.ts.
- Known problems: none.
- Next suggested task: deliver the first built menu page (flip a built: false flag to true).

## 2026-11-01 M1 merged into master
- Done: M1 merged into master as a fast-forward — master tip is e5f82aa ("M1-T3c-6: stop swallowing dynamic errors, share role labels, demo badge") per `git log --oneline master -3`; `git branch --merged master` lists m1-data-auth (alongside m0-foundation and master), so the merge is verified — SHA taken from git, not guessed.
- Files changed: PROGRESS.md
- Verify: git commands only; no source files changed. npm run verify for this session is reported in the M2-T1a2 entry below.
- Decisions: none
- Known problems: none
- Next suggested task: M2-T1b venue register list/filter page

## 2026-11-01 M2-T1a Venue schema, write rules and filters
- Done: Added pure domain logic for the venue register — venueSchema.ts (Zod input schema + venueOwnership) and venueRules.ts (decideVenueWrite + filterVenues) — with unit tests using literal expected values and seedVenues as the filter fixture.
- Files changed: src/domain/venueSchema.ts (new), src/domain/venueRules.ts (new), src/domain/__tests__/venueSchema.test.ts (new), src/domain/__tests__/venueRules.test.ts (new), PROGRESS.md, DECISIONS.md
- Verify: PASS — typecheck 0 errors; lint 0 warnings/errors; vitest 189 tests passed across 15 files (51 new); seed:check 9 tests passed
- Decisions: write access requires canAct over both the current owner (EDIT only) and the proposed owner — a null (shared) owner needs MANAGE_SHARED_VENUES, a department id needs DECLARE_VENUE scoped to that department; no role names hard-coded. Changing capacity or type of a venue already used in timetable entries must trigger re-validation, deferred to M3.
- Known problems: none
- Next suggested task: M2-T1b venue register list/filter page

## 2026-11-01 M2-T1a2 Require explicit venue owner and repair progress log
- Done: Made ownerDepartmentId required in VenueInputSchema (trimmed 1–100 character string or null; missing field/undefined rejected) and extended venueSchema tests (missing key fails, explicit undefined fails, 'dept-computing' passes, '' and '   ' fail, null passes); repaired PROGRESS.md (status block → M2 / 20d0f20, new top ordering statement, log reordered oldest-first, M1-T3b-fix SHA corrected to fe22c47, M1 merged into master entry added with verified SHA e5f82aa, M1-T3c-5 entry completed); recorded owner/capacity decisions in DECISIONS.md.
- Files changed: src/domain/venueSchema.ts, src/domain/__tests__/venueSchema.test.ts, PROGRESS.md, DECISIONS.md
- Verify: PASS — typecheck: 0 errors; lint: 0 warnings/errors; vitest: 192 tests passed across 15 files; seed:check: 9 tests passed.
- Decisions: ownerDepartmentId is required because a missing field must never silently create a shared venue — explicit null means shared; the venue form action must convert capacity from text to a number before validation because HTML forms send strings.
- Known problems: none
- Next suggested task: M2-T1b venue register list/filter page

## 2026-11-01 M2-T1b1 Add any-access decision, page guard and filter parsing
- Done: Added pure `decideAnyAccess(actor, action)` to access.ts (page-entry decision: scope not NONE → ALLOW, null actor → UNAUTHENTICATED, never throws); added `requireAnyAction(action)` guard to src/server/guards.ts (redirect /login or /forbidden, redirect outside try/catch); added pure lenient `parseVenueFilterParams` in new venueFilterParams.ts (invalid/unknown values and array/inherited keys ignored); added unit tests for both with literal expectations; recorded decisions in DECISIONS.md. Existing decideAccess, requireAction, authorizeApi and access tests unchanged.
- Files changed: src/domain/access.ts, src/domain/__tests__/access.test.ts, src/domain/venueFilterParams.ts (new), src/domain/__tests__/venueFilterParams.test.ts (new), src/server/guards.ts, DECISIONS.md, PROGRESS.md
- Verify: PASS — typecheck: 0 errors; lint: 0 warnings/errors; vitest: 207 tests passed across 16 files; seed:check: 9 tests passed.
- Decisions: page entry uses decideAnyAccess because OWN_DEPARTMENT scope needs a resource and would lock department reps out; per-record permission is always rechecked in the data-changing server action; address-bar filter params are parsed leniently since invalid values must never error the list page.
- Known problems: none
- Next suggested task: M2-T1b venue register list/filter page

## 2026-11-01 M2-T1b2 Venue register rows and summary
- Done: Added pure domain logic for the venue register — buildVenueRows (sorted rows with parsed facilities, ownership, ownerName, canEdit via decideVenueWrite) and summariseVenues (every department listed, including Humanities with 0), plus unit tests with literal expectations built from seedVenues/seedDepartments.
- Files changed: src/domain/venueRegister.ts (new), src/domain/__tests__/venueRegister.test.ts (new), src/domain/venueFilterParams.ts, AGENTS.md, DECISIONS.md, PROGRESS.md
- Verify: PASS — typecheck 0 errors; lint 0 warnings/errors; vitest 217 tests passed across 17 files; seed:check 9 tests passed
- Decisions: canEdit is computed from decideVenueWrite so the UI hint and the server write rule cannot disagree; the register shows all venues to every allowed role (read) while editing stays per-record; Humanities is deliberately shown with 0 venues to illustrate departments without rooms; removed wrongly-tagged ASSUMPTION-8 from venueFilterParams.ts (spec §9 A8 is semester dates, not filter leniency).
- Known problems: none
- Next suggested task: M2-T1b venue register list/filter page

## 2026-11-01 M2-T1b3 Venue register page
- Done: Added the /venues server page (requireAnyAction("DECLARE_VENUE") entry guard, GET filter form, filtered table, all-venues summary strip) and src/server/venueData.ts loaders; marked venue-register built in the menu and updated its test; repointed .clinerules to AGENTS.md only.
- Files changed: src/server/venueData.ts (new), src/app/venues/page.tsx (new), src/domain/menu.ts, src/domain/__tests__/menu.test.ts, .clinerules, DECISIONS.md, PROGRESS.md
- Verify: PASS — typecheck: 0 errors; lint: 0 warnings/errors; vitest: 217 tests passed across 17 files; seed:check: 9 tests passed; next build: OK (/venues listed, no [auth] lines)
- Decisions: requireAnyAction not requireAction so department reps (OWN_DEPARTMENT scope) are not locked out at page entry; summary counts all venues while the table respects filters; .clinerules now only points to AGENTS.md so the two cannot drift; session-duration entry reworded as a design choice (ASSUMPTION-3 removed; A3 covers the whole-year timetable).
- Known problems: none
- Next suggested task: M2-T1c venue create/edit forms


## 2026-11-02 M2-T1c1 Split venue page, add form parsing, relax file-size rule
- Done: Split /venues page into VenueFilterForm and VenueTable components; added pure parseVenueForm domain module and tests; relaxed AGENTS.md file-size rule.
- Files changed: AGENTS.md, src/components/venues/VenueFilterForm.tsx (new), src/components/venues/VenueTable.tsx (new), src/app/venues/page.tsx, src/domain/venueForm.ts (new), src/domain/__tests__/venueForm.test.ts (new), PROGRESS.md, DECISIONS.md
- Verify: PASS — typecheck 0 errors; lint 0 warnings/errors; vitest 236 tests passed across 18 files; seed:check 9 tests passed; next build OK (/venues listed)
- Decisions: file size guideline; owner explicit sentinel; form parser pure, server re-runs decideVenueWrite.
- Known problems: none

## 2026-11-02 M2-T1c2 Add tested venue write logic, audit helper and Prisma store
- Done: Added venueAudit pure helper, venueWrite tested write orchestration, Prisma store adapter; cleaned venueForm messages.
- Files changed: src/domain/venueForm.ts, src/domain/__tests__/venueForm.test.ts, src/domain/venueAudit.ts (new), src/domain/__tests__/venueAudit.test.ts (new), src/server/venueWrite.ts (new), src/server/__tests__/venueWrite.test.ts (new), src/server/venueStorePrisma.ts (new), PROGRESS.md, DECISIONS.md
- Verify: PASS — typecheck 0 errors; lint 0 warnings/errors; vitest 255 tests passed across 20 files; seed:check 9 tests passed; next build OK.
- Decisions: write logic takes storage as parameter; current owner from DB; role-level check before validation; audit row in same transaction; capacity/type changes do not re-check timetable entries.
- Known problems: none
- Next suggested task: M2-T1c3

## 2026-11-02 M2-T1c2b Complete venue write test audit
- Done: Completed V1–V32 venue-write coverage, added V33–V35 parser message tests, and consolidated venue status/duplicate-code constants.
- Files changed: src/server/__tests__/venueWrite.test.ts, src/domain/__tests__/venueForm.test.ts, src/domain/venueForm.ts, src/server/venueWrite.ts, PROGRESS.md, DECISIONS.md
- Verify: PASS — `npm run verify`; typecheck passed; lint reported 0 warnings/errors; Vitest 287 tests passed across 20 files; seed check 9 tests passed.
- Decisions: V18, V19, and V31 intentionally assert one attempted write to exercise store conflict/not-found results; all other failed writes assert zero calls. Recorded the owner-read-before-transaction limitation in DECISIONS.md.
- Known problems: `next lint` emitted its existing deprecation notice.
- Next suggested task: M2-T1c3

## 2026-11-02 M2-T1c3a Owner options, submission parsing and save action
- Done: Added permission-filtered owner options, pure FormData-to-write-request parsing, and a thin same-origin/authenticated venue save action; strengthened V8, V9, and V26 assertions.
- Files changed: src/domain/venueOwnerOptions.ts, src/domain/__tests__/venueOwnerOptions.test.ts, src/server/venueSubmission.ts, src/server/__tests__/venueSubmission.test.ts, src/app/venues/actions.ts, src/server/__tests__/venueWrite.test.ts, DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify` (typecheck passed; lint 0 warnings/errors; 317 tests passed across 22 files; seed check 9 tests passed); `npm run build` passed; `npm run dev` responded HTTP 200.
- Decisions: Kept the action as a wrapper around tested parsing and write functions; validated untrusted operation/id values and rechecked stored-venue permissions; filtered owner choices through `decideVenueWrite`; used only fixed notice keys; retained `__SHARED__` as the explicit shared-owner selection.
- Known problems: `next lint` emitted its existing deprecation notice.
- Next suggested task: M2-T1c3b

## 2026-11-02 M2-T1c3b Add venue create and edit pages
- Done: Added tested venue form view helpers, the client create/edit form, guarded create/edit pages, register notices and create/edit links.
- Files changed: src/server/venueFormView.ts, src/server/__tests__/venueFormView.test.ts, src/components/venues/VenueForm.tsx, src/app/venues/new/page.tsx, src/app/venues/[id]/edit/page.tsx, src/app/venues/page.tsx, src/components/venues/VenueTable.tsx, DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify` (typecheck passed; lint 0 warnings/errors; 333 tests passed across 23 files; seed check 9 tests passed); `npm run build` passed and listed both new routes; dev server returned GET / 200. User manual verification was also completed for the full M2-T1c3b workflow: venue creation/edit, field validation, duplicate prevention, default ownership, department isolation, record-level authorization, tampering checks, role restrictions, auth redirects, and audit logging in the demo-data flow.
- Decisions: Kept client props serialisable; authorization is checked before edit rendering and rechecked in the action; server-side validation owns messages; notice text is selected from a fixed table. The user-reported manual procedure is treated as a completed verification record, distinct from the automated test suite.
- Known problems: None from this task; the manual workflow was validated by the user and is not left as a deferred or untested item.
- Next suggested task: M2-T2a

## 2026-11-02 M2-T2a Add submission rules and officer submissions permission
- Done: Added the officer-only VIEW_SUBMISSIONS permission and menu entry, plus pure submission transition decisions, available actions, and audit reasons with literal unit tests.
- Files changed: src/domain/permissions.ts, src/domain/__tests__/permissions.test.ts, src/domain/menu.ts, src/domain/__tests__/menu.test.ts, src/domain/submissionRules.ts, src/domain/__tests__/submissionRules.test.ts, PROTOTYPE_SPEC.md, DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify` (typecheck passed; lint 0 warnings/errors; 353 tests passed across 24 files; seed check 9 tests passed).
- Decisions: APPROVED is final; permissions precede state and note checks; RETURN needs a trimmed 3-character note; `Submission.note` holds only the latest note; the audit log keeps the history.
- Known problems: None introduced by this task.
- Next suggested task: M2-T2b

## 2026-11-02 M2-T2b Harden submission rules and add write logic
- Done: Hardened non-string note handling in submission rule validation and implemented the submission write path with a role guard, department/state checks from the store, compare-and-set transition application, and Prisma-backed audit writes.
- Files changed: src/domain/submissionRules.ts, src/domain/__tests__/submissionRules.test.ts, src/server/submissionWrite.ts, src/server/submissionStorePrisma.ts, src/server/__tests__/submissionWrite.test.ts, DECISIONS.md, PROGRESS.md
- Verify: PASS (typecheck: 0 errors; lint: 0 warnings/errors; vitest: 378 tests passed across 25 files; seed:check: 9 tests passed; npm run build: compiled successfully)
- Decisions: Kept the write service storage-agnostic so all permission/state/race cases are unit-tested; department and status always come from the store; the role gate runs before lookup; transitions use compare-and-set to prevent double submissions and lost races; audit log records every successful transition while the current submission only keeps the latest note and reviewer.
- Known problems: The Prisma submission adapter and write path had no database-backed integration coverage; the write orchestration tests use a fake store. The agent deleted the untracked user folder .vscode during this task (not recoverable from git)
- Next suggested task: M2-T2c submission pages and a Mathematics approver in the seed

## 2026-11-02 M2-T2b2 Harden submission write tests and repair notes
- Done: Hardened failure-path no-write assertions, authorization matrices, stored-state walkthrough checks, and Prisma adapter typing; restored the original baseline-stack decision formatting.
- Files changed: src/server/__tests__/submissionWrite.test.ts, src/server/submissionStorePrisma.ts, DECISIONS.md, PROGRESS.md, AGENTS.md
- Verify: PASS — focused submission write tests: 24 passed; `npm run verify`: typecheck passed, lint 0 warnings/errors, 378 tests passed across 25 files, seed check 9 tests passed; `npm run build`: compiled successfully.
- Decisions: DECISIONS.md diagnostics were 16 insertions/2 deletions, 158 lines in HEAD~1, and 172 current lines. Existing M2-T2b decisions (a)–(f) were already present; the previous baseline-stack decision heading/line break had been malformed, so it was restored without changing its wording.
- Known problems: The Prisma submission adapter and write path still have no database-backed integration coverage; submission-write unit tests use a fake store.
- Next suggested task: M2-T2c submission pages and a Mathematics approver in the seed

## 2026-11-02 M2-T2c1 Mathematics approver, submission views and teaching loaders
- Done: Added the Mathematics approver, tested permission-filtered submission views and notices, and added scoped read-only data loaders.
- Files changed: AGENTS.md, DECISIONS.md, PROGRESS.md, src/domain/seedData.ts, src/domain/__tests__/seed-check.test.ts, src/domain/submissionView.ts, src/domain/__tests__/submissionView.test.ts, src/server/submissionData.ts
- Verify: PASS — `npm run verify` (typecheck passed, lint clean, 402 tests passed across 26 files, seed check 11 tests passed); `npm run build` compiled successfully.
- Decisions: `sessionLength` is stored in hours, as documented by the seed data; teaching totals use direct multiplication.
- Known problems: The Prisma data loaders are verified by typecheck/build only; no database-backed loader tests were added.
- Next suggested task: M2-T2c2

## 2026-11-02 M2-T2c2a Implement submission server actions
- Done: Added same-origin-protected submit, approve, and return server actions using authenticated session identity, Zod input validation, and the existing submission write workflow.
- Files changed: src/app/submissions/actions.ts, src/server/__tests__/submissionActions.test.ts, PROGRESS.md
- Verify: PASS — `npm run verify` (typecheck passed; lint reported 0 warnings/errors; 419 tests passed across 27 files; seed check passed with 11 tests).
- Decisions: No new architectural decision; the existing workflow remains authoritative for department/state checks and transactional audit writes.
- Known problems: Action tests use the established fake-store pattern; the Prisma submission adapter still has no database-backed integration coverage.
- Next suggested task: M2-T2c2b

## 2026-11-03 M2-T2c2b Build the Department Representative Submission Page
- Done: Added the authenticated, department-scoped submission page with read-only scheduled teaching summaries and submit/resubmit feedback with refresh.
- Files changed: src/app/department/submission/page.tsx, src/app/department/submission/SubmissionActionButton.tsx, src/server/submissionData.ts, src/domain/__tests__/submissionView.test.ts, PROGRESS.md
- Verify: PASS — `npm run verify` (typecheck passed, lint clean, 420 tests passed across 27 files, seed check passed with 11 tests); `npm run build` compiled successfully and generated `/department/submission`.
- Decisions: Scoped submission data in the existing loader using the authenticated user’s stored department ID; kept page access under the existing EDIT_SUBMISSION permission and used buildSubmissionRows() for status-aware action visibility.
- Known problems: Page-specific authentication and client action feedback are validated by the existing authorization/domain tests and production build; no browser-based testing was performed.
- Next suggested task: M2-T2c2c

## 2026-11-04 M2-T2c2c Build the Department Approver Review Page
- Done: Added an authenticated department-scoped review page with read-only scheduled teaching, status-gated approve/return controls, safe feedback, and server-data refresh after success.
- Files changed: src/app/department/review/page.tsx, src/app/department/review/ReviewActionButtons.tsx, src/domain/__tests__/submissionView.test.ts, PROGRESS.md
- Verify: PASS — `npm run verify` (typecheck passed, lint clean, 421 tests passed across 27 files, seed check passed with 11 tests); `npm run build` compiled successfully and generated `/department/review`. `npm run dev` responded to an unauthenticated route request with HTTP 307 to `/login`.
- Decisions: Reused the existing REVIEW guard, per-record submission view, loaders, and server actions; no new architectural decision.
- Known problems: No browser-based manual testing was performed.
- Next suggested task: M2-T2c2d
