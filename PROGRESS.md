# PROGRESS.md
Entries are listed newest-last; the Status block below is authoritative.
(The agent appends entries here at the end of every task. This file is the agent's memory between sessions.)

## Status
- Current milestone: M3
- Last verified code commit: the M3-T2a commit at the tip of `m3-validator` (SHA reported in its task report); M3-T1, M3-T1a and M3-T1b are the entries below it
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

## 2026-11-04 M2-T2c2d Build officer submission overview and activate submission navigation
- Done: Added the read-only /officer/submissions overview page (requireAnyAction("VIEW_SUBMISSIONS") entry guard, cross-department loadSubmissionRecords() with no department restriction, OVERVIEW rows via buildSubmissionRows, per-submission scheduled teaching via loadTeachingRecords and summariseTeaching, note/reviewer shown when present, empty states for no submissions and no teaching). Flipped built to true for submission-edit, submission-review and submission-overview in menu.ts and updated the menu built-flag test to expect exactly those four built items (with venue-register).
- Files changed: src/app/officer/submissions/page.tsx (new), src/domain/menu.ts, src/domain/__tests__/menu.test.ts, PROGRESS.md
- Verify: PASS — `npm run verify` (typecheck passed; lint 0 warnings/errors aside from the known `next lint` deprecation notice; 421 tests passed across 27 files; seed check passed with 11 tests); `npm run build` compiled successfully and listed `/officer/submissions` as a dynamic route.
- Decisions: Reused the existing OVERVIEW view for status labels, tones, sorting and permission filtering — no new tests added in submissionView.test.ts because officer cross-department sorting, action-free rows and role denials were already covered there; the page exposes no submit/approve/return/resubmit controls (buildSubmissionRows returns empty actions for OVERVIEW); page entry uses requireAnyAction consistent with the other submission pages (VIEW_SUBMISSIONS is ALL-scope for OFFICER and NONE for every other role, so the guard still denies all non-officers).
- Known problems: No browser-based manual testing was performed; the Prisma loaders remain covered by typecheck/build only.
- Next suggested task: M2-T3 (lecturer availability form)

## 2026-11-04 M2-T3a Lecturer availability domain rules
- Done: Added the pure availability rules for the lecturer form — period parsing/validation (MON-FRI, HH:MM, start before end), half-open overlap detection with adjacent periods allowed, duplicate rejection that names the stored row, record-to-period conversion that keeps only `available: false` rows, and `findUnavailableConflict()` as the rule the future `LECTURER_UNAVAILABLE` validator check will use.
- Files changed: src/domain/lecturerAvailability.ts (new), src/domain/__tests__/lecturerAvailability.test.ts (new), DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify` (typecheck 0 errors; lint "No ESLint warnings or errors" plus the known `next lint` deprecation notice; 458 tests passed across 28 files, including 37 new availability tests; seed check 11 tests passed).
- Decisions: unavailable-period interpretation (confirmed with the user, matches all four seeded rows and spec §7 `LECTURER_UNAVAILABLE`); no reason field and no 08:00-17:00 restriction in this form; `available: true` rows restrict nothing and are dropped; the order message is only emitted when both times are well-formed; malformed times never overlap, so a corrupt row cannot reject a valid period; `findUnavailableConflict` takes stored periods (with ids) so a violation can name the row.
- Known problems: None from this task. No persistence, permission, page or validator wiring yet — those are M2-T3b/c/d and M3-T1; the conflict validator does not exist, so nothing consumes these periods at runtime yet.
- Next suggested task: M2-T3b (SET_LECTURER_AVAILABILITY permission with SELF scope)

## 2026-11-04 M2-T3a (review correction) timesOverlap requires positive-length ranges
- Done: Strengthened `timesOverlap()` so both ranges must be well-formed HH:MM pairs with `start < end` before any comparison, closing the false-overlap edge case the review found (query 15:00-12:00 against a saved 10:00-20:00 range); added reversed/zero-length tests for `timesOverlap`, `periodsOverlap` and `findUnavailableConflict`.
- Files changed: src/domain/lecturerAvailability.ts, src/domain/__tests__/lecturerAvailability.test.ts, DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify` (typecheck 0 errors; lint "No ESLint warnings or errors" plus the known `next lint` deprecation notice; 461 tests passed across 28 files; seed check 11 tests passed).
- Decisions: Follow-up commit on the same task rather than an amend, so the review correction is visible in history; a reversed or zero-length query range is treated as matching nothing (it contains no minute), which also means `findUnavailableConflict` cannot report a violation for a degenerate entry.
- Known problems: None. No behaviour change for validated form input — the form rules already reject a start that is not before the end.
- Next suggested task: M2-T3b (SET_LECTURER_AVAILABILITY permission with SELF scope)

## 2026-11-04 M2-T3b Lecturer availability permissions
- Done: Added `SET_LECTURER_AVAILABILITY` (LECTURER SELF only) and `VIEW_LECTURER_AVAILABILITY` (LECTURER SELF, OFFICER ALL, ADMIN ALL) to the pure permission matrix, with literal per-role scope expectations, SELF/ALL behaviour tests through `canAct`, updated `allowedActions` lists, and two new PROTOTYPE_SPEC §8 rows (record own unavailable periods; view a lecturer's unavailable periods).
- Files changed: src/domain/permissions.ts, src/domain/__tests__/permissions.test.ts, PROTOTYPE_SPEC.md, DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify` (typecheck 0 errors; lint "No ESLint warnings or errors" plus the known `next lint` deprecation notice; 471 tests passed across 28 files, including 10 new availability-permission tests; seed check 11 tests passed). `src/domain/__tests__/menu.test.ts` still passes unchanged (12 tests), confirming no navigation change.
- Decisions: Read separated from write so officers/admins can inspect but never modify; ADMIN ALL on the read action follows the existing ADMIN convention (system-wide for MANAGE_USERS and VIEW_* only); both actions keyed on `subjectUserId` (the lecturer's user id, not `Lecturer.id`) so a browser-supplied lecturer id cannot redirect ownership; DEPT_REP/APPROVER/STUDENT are NONE for both; actions appended to `ACTIONS` so existing order is preserved.
- Known problems: No server action, loader or page enforces these permissions yet — that is M2-T3c (persistence/actions) and M2-T3d (page + menu entry). Nothing in the app is protected by them until then.
- Next suggested task: M2-T3c (Prisma persistence, server actions and the validator-shaped loader)

## 2026-11-04 M2-T3c Lecturer availability persistence and server actions
- Done: Added the server-side availability layer — an injected store interface with a Prisma implementation over the existing Lecturer/LecturerAvailability models (no migration), `performAddUnavailablePeriod` (SET_LECTURER_AVAILABILITY SELF check, profile resolved from the authenticated user id, duplicate/overlap/malformed decisions delegated to the pure domain rules, rows persisted with `available: false`), `performRemoveUnavailablePeriod` (id selects the row, ownership verified from the stored record's lecturer->user link before delete) and loaders `loadLecturerAvailability` (per-subject VIEW check: SELF for lecturers, ALL for officers/admins) and `loadAllLecturerAvailability` (ALL-scope only, grouped `{lecturerUserId, lecturerId, periods:[{id, day, start, end}]}` shape for the M3 validator), plus `"use server"` actions with same-origin + session checks that accept only day/start/end or an availability id.
- Files changed: src/server/lecturerAvailability.ts (new), src/server/__tests__/lecturerAvailability.test.ts (new), src/app/lecturer/availability/actions.ts (new), PROGRESS.md
- Verify: PASS — `npm run verify` (typecheck 0 errors; lint "No ESLint warnings or errors" plus the known `next lint` deprecation notice; 516 tests passed across 29 files, including 45 new server availability tests; seed check 11 tests passed). `npm run build` compiled successfully (16 routes, all dynamic). Dev smoke check: `npm run dev` served /login with 200, then was stopped.
- Decisions: Persistence kept server-authoritative — the actor is the only identity input; forged `lecturerId`/`userId`/`role` keys in the action payload are rejected before the domain rules run, and the conflict check only ever sees the caller's own periods. Officer/admin read-only enforced by giving them SET scope NONE (checked twice: before any query and again against the record's owner on removal). The one-file server module combines what venue/submissions split into `*Write.ts` + `*StorePrisma.ts` in order to stay within the four-file task limit; a future task can split it if it grows. `loadAllLecturerAvailability` uses a dummy subject resource to require ALL scope, so lecturers cannot enumerate other lecturers.
- Known problems: No UI consumes the actions/page loader yet — that is M2-T3d; nothing calls `findUnavailableConflict` with this data yet — that is M3-T1. The Prisma store itself is exercised only by typecheck/build (same as the existing Prisma stores); unit tests use the injected fake store. Concurrent duplicate saves (two tabs, same period) are not serialised — acceptable for the prototype, unlike submissions which have status checks.
- Next suggested task: M2-T3d (lecturer availability page + menu entry consuming the loaders and actions)

## 2026-11-04 M2-T3c (review correction) read authorization order and minimal view DTO
- Done: Applied the two review corrections in src/server/lecturerAvailability.ts — (1) `loadLecturerAvailability` now decides `VIEW_LECTURER_AVAILABILITY` against the supplied `subjectUserId` BEFORE any store query, so a denied caller gets the same FORBIDDEN for a nonexistent subject as for a real one (existence oracle closed, no data read); (2) `LecturerAvailabilityView` no longer exposes `lecturerUserId` — the returned shape is exactly `{ lecturerId, periods: [{id, day, start, end}] }` while the user id remains in the internal persistence record for ownership checks.
- Files changed: src/server/lecturerAvailability.ts, src/server/__tests__/lecturerAvailability.test.ts, PROGRESS.md
- Verify: PASS — `npm run verify` (typecheck 0 errors; lint "No ESLint warnings or errors" plus the known `next lint` deprecation notice; 518 tests passed across 29 files, including 2 new regression tests; seed check 11 tests passed). `npm run build` compiled successfully.
- Decisions: The regression test counts every fake-store method call and asserts `queryCount === 0` for DEPT_REP/APPROVER/STUDENT and for another lecturer probing a nonexistent subject; a SELF lecturer probing their own missing profile returns the same empty success as any missing subject (never FORBIDDEN-by-existence). The view/period key order is asserted explicitly so future DTO drift fails the test.
- Known problems: None new. T3d must consume the view without a user id (page loader takes `actor.id` as the subject anyway).
- Next suggested task: M2-T3d (lecturer availability page + menu entry consuming the loaders and actions)

## 2026-11-04 M2-T3d Lecturer availability page and navigation
- Done: Added the lecturer "My availability" workspace — a self-guarding server page that loads only the session user's own periods through `loadLecturerAvailability(store, user, user.id)` and renders them sorted by day then start with a per-row Remove button — plus a client form (weekday select, two `type="time"` inputs, `useTransition` pending state, field-level validation errors, live success/alert feedback, `router.refresh()` after every successful write) and the empty state. Added the "My availability" menu item and corrected the stale comment in menu.ts that claimed every item still had `built: false`.
- Files changed: src/app/lecturer/availability/page.tsx (new), src/app/lecturer/availability/AvailabilityForm.tsx (new), src/domain/menu.ts, src/domain/__tests__/menu.test.ts, PROGRESS.md
- Verify: PASS — `npm run verify` (typecheck 0 errors; lint "No ESLint warnings or errors" plus the known `next lint` deprecation notice; 519 tests passed across 29 files, menu.test.ts now 13 tests with 1 new audience test; seed check 11 tests passed). `npm run build` compiled successfully and listed `ƒ /lecturer/availability 2.56 kB 118 kB`. Browser verification with real sessions (dev server on port 3002, then stopped): add saved "Tuesday 09:00–10:00." and the row appeared after refresh; duplicate rejected naming the stored row; overlap rejected naming the stored row; adjacent 10:00–11:00 accepted; reversed 14:00→13:00 and zero-length 13:00→13:00 both rejected with "Start must be earlier than end" and no write; Remove deleted the row; Lecturer D saw the empty state and none of Lecturer A's rows; the LECTURER home menu listed "My availability" and the OFFICER menu omitted it; an officer navigating directly to `/lecturer/availability` was redirected to `/forbidden` ("You do not have permission to open that page."). Test rows created during UI testing were removed and `prisma/dev.db` was confirmed to hold only the four seeded availability rows.
- Decisions: The page entry guard is `SET_LECTURER_AVAILABILITY` (SELF scope, lecturers only) rather than the VIEW action, because this page is a write workspace — officers/admins hold `VIEW_LECTURER_AVAILABILITY` with ALL scope for the future M3 validator but have no availability page of their own, so they are redirected instead of being shown a read-only copy; the read then re-checks VIEW with the session user's own id, and the removal action re-checks ownership against the stored record, so no browser-supplied id can reach the store. `redirect()` is called outside try/catch because it works by throwing. Navigation visibility is lecturer-only through a new `audienceRoles?: readonly UserRole[]` field on `MenuItem` that `menuForRole` filters on, with a comment stating that it narrows navigation only and that server guards remain the sole enforcement point — this avoided weakening the accepted T3b permission matrix (removing the officers' ALL scope would have broken the read contract T3c delivered). No `revalidatePath`: `router.refresh()` re-runs this page's own server component. The form reuses the T3c server actions and pure domain messages — no validation logic duplicated in the client.
- Known problems: The form deliberately allows a period overlapping another lecturer's data — cross-lecturer conflicts are the M3 validator's job (`findUnavailableConflict` still has no runtime consumer). Nothing prevents a lecturer from marking the whole weekday unavailable, which would make them unschedulable; that is a data-quality rule the demo does not enforce. The new page components are covered by typecheck/build and the real browser pass, not by component tests (no React testing library in the prototype).
- Next suggested task: M3-T1 (timetabling validator that consumes `loadAllLecturerAvailability` and `findUnavailableConflict`)

## 2026-11-04 M3-T1 Conflict validator
- Done: Added the pure `validateEntries(entries, context, policy)` function returning typed violations for all 8 hard constraints (VENUE_OVERLAP, LECTURER_OVERLAP, GROUP_OVERLAP, CAPACITY, VENUE_TYPE, LECTURER_UNAVAILABLE, VENUE_UNAVAILABLE, OUT_OF_SLOT), plus the `PolicyConfig` / `DEFAULT_POLICY` module, with 21 tests (≥ 2 per violation type, a clean case, multiple-violations-on-one-entry, missing-context, and seed planted-conflict detection).
- Files changed: src/domain/policy.ts (new), src/domain/validator.ts (new), src/domain/__tests__/validator.test.ts (new), PROGRESS.md, DECISIONS.md
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint "No ESLint warnings or errors" plus the known `next lint` deprecation notice; vitest 540 tests passed across 30 files (21 new); seed check 11 tests passed. `npm run build`: compiled successfully, 17/17 pages generated, exit 0.
- Decisions: PolicyConfig passed as a parameter — no globals or clock; ValidationContext uses pre-resolved lookups so the validator stays pure and the server layer (M3-T2) builds it from DB queries; reuses `timesOverlap` and `findUnavailableConflict` from lecturerAvailability.ts for shared half-open range semantics; OUT_OF_SLOT checks day → format → order → slot window → lunch in that order so the message names the most fundamental problem first; missing teaching/venue in context skips dependent checks rather than crashing; load limits (maxHoursPerLecturerPerDay, maxClassesPerGroupPerDay) are not checked — they are soft constraints for the M4 generator, not hard violations; facility matching not checked because the domain model has no per-unit required-facilities field (ASSUMPTION-18 maps to venueTypeRequired only).
- Known problems: No runtime consumer yet — M3-T2 draft editor will build the ValidationContext from DB queries and call validateEntries. Messages use venue codes and unit codes from the context but not lecturer display names (M3-T2 can resolve lecturer IDs to names when rendering).
- Next suggested task: M3-T2 (officer draft editor: view draft entries, move/add an entry, show violations inline)

## 2026-11-05 M3-T1a Prevent incomplete validation context from being treated as valid
- Done: Changed the `validateEntries()` result contract from `Violation[]` to a discriminated `ValidationOutcome` — `{status:"ok", violations}` or `{status:"incomplete", violations, missingContext}` — where `missingContext` is a typed `MissingContextError[]` (`MISSING_TEACHING` / `MISSING_VENUE`, each with entryIndex, entryId, refId and a plain-language message). Entries with unresolved teaching/venue still skip the checks that need them (no crash) and are now named as data-integrity failures, so a caller can never read an empty violations list as a conflict-free timetable. The eight scheduling violation types and their behaviour for complete inputs are unchanged. Context lookups now resolve own keys only, so a reference like `__proto__` is reported missing instead of counting as resolved data.
- Files changed: src/domain/validator.ts, src/domain/__tests__/validator.test.ts, DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint "No ESLint warnings or errors" plus the known `next lint` deprecation notice; vitest 547 tests passed across 30 files (validator.test.ts 21 → 28); seed check 11 tests passed. `npm run build`: compiled successfully in 9.0s, 17/17 pages generated, exit 0.
- Decisions: recorded in DECISIONS.md (M3-T1a a–e) — the outcome is a discriminated union rather than a thrown error (the validator must stay pure and total and M3-T2 needs every problem in a draft); missing context is its own channel rather than a ninth `ViolationType`, keeping data-integrity failures distinct from constraint breaches (this supersedes M3-T1 decision (g) only in that respect — the skip behaviour is retained); `entryIndex` is reported because the editor highlights rows by position; an empty entries list against an empty context is `ok` because no check was left unrun; context lookups use `Object.hasOwn` so a prototype-chain key is never counted as resolved data. M3-T1 decision (g) is marked superseded.
- Known problems: `validateEntries()` still has no runtime consumer, so nothing in the app surfaces an "incomplete" result yet — M3-T2 must render `missingContext` (a data-integrity notice, not a violation row) and must not treat `status:"incomplete"` as clean. The M4-T1 acceptance wording "zero hard violations validated by M3-T1" now maps to `status === "ok" && violations.length === 0`; the M4 task prompt should be checked against this contract when it is picked up.
- Next suggested task: M3-T2 (officer draft editor: view draft entries, move/add an entry, show violations inline)

## 2026-11-05 M3-T1b Restore validator file-size compliance without changing behavior
- Done: Extracted `checkSlot()` into `src/domain/slotValidation.ts` so `validator.ts` drops from 322 to 268 lines while preserving the accepted M3-T1a validation contract unchanged; `validateEntries()` remains the public entry point.
- Files changed: src/domain/slotValidation.ts (new), src/domain/validator.ts, DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint "No ESLint warnings or errors" plus the known `next lint` deprecation notice; vitest 547 tests passed across 30 files (validator.test.ts 28/28 unchanged); seed check 11 tests passed. `npm run build`: compiled successfully in 5.9s, 17/17 pages generated, exit 0.
- Decisions: `slotValidation.ts` imports `EntryInput` and `Violation` from `validator.ts` via `import type` (erased at compile time, no runtime circular dependency); `validator.ts` imports `checkSlot` as a runtime value, so the dependency graph runs one-way at runtime (validator → slotValidation). The `TIME_HHMM_REGEX` and `isStartBeforeEnd` imports from `./types` moved to `slotValidation.ts` and were removed from `validator.ts` (only `checkSlot` used them). Recorded in DECISIONS.md.
- Known problems: none
- Next suggested task: M3-T2 (officer draft editor: view draft entries, move/add an entry, show violations inline)
## 2026-11-05 M3-T2a Server-side draft validation loader
- Done: Added the read-only server service `loadDraftForValidation(store, actor, versionId, policy?)` — decides EDIT_DRAFT before any read, requires the stored version status to be DRAFT, loads only that version's entries, resolves teachings+units, venues, lecturer unavailable periods and venue unavailable periods from the existing Prisma models, builds the exact `EntryInput[]` and `ValidationContext`, and returns `{ version, entries, validation }` from the unchanged `validateEntries()`; plus `createDraftValidationStore()`, the Prisma read-only adapter. No UI, no writes, no schema change, no validator change.
- Files changed: src/server/draftValidation.ts (new), src/server/draftStorePrisma.ts (new), src/server/__tests__/draftValidation.test.ts (new), DECISIONS.md, PROGRESS.md
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint "No ESLint warnings or errors" plus the known `next lint` deprecation notice; vitest 586 tests passed across 31 files (39 new); seed check 11 tests passed. `npm run build`: compiled successfully, 17/17 pages generated, exit 0. Real-database smoke check (temporary script, then deleted): officer loaded `ver-s1-planted` from `prisma/dev.db` — 10 entries, `status: "ok"`, the two planted conflicts; student got FORBIDDEN with zero reads; unknown id got NOT_FOUND.
- Decisions: recorded in DECISIONS.md (M3-T2a a-j) — permission before any query; typed refusal codes that carry no draft data; NOT_DRAFT for PUBLISHED/ARCHIVED; store contract separate from the Prisma adapter (mirrors the venue/submission split); defensive re-filter of entries by version id; entries re-ordered into policy day order so `entryIndex` matches the week the officer reads; a store failure is INTERNAL_ERROR and never an empty availability list; corrupt version status throws instead of being guessed; DTO keeps unresolved rows visible with null codes; the service file is 376 lines and was left unsplit to respect the five-file cap.
- Known problems: the Prisma adapter has no automated database-backed test (same as every earlier Prisma store) — it was exercised once manually as described above. A leftover non-seed row was found in `prisma/dev.db`: `LecturerAvailability` id `cmw1h5l7k0001uvkswii6fa4i` (lecturer-B, WED 07:00-09:00) appears to be a UI-test row from M2-T3d that was not removed; nothing was deleted. The service has no page or route consumer yet — that is M3-T2b.
- Next suggested task: M3-T2b (officer draft editor UI consuming this loader; move/add entries with inline violations)
## 2026-11-05 M3-T2b1 Server-side move operation for a draft entry
- Done: Added the server-side `performDraftMove(store, actor, request)` write operation — EDIT_DRAFT authorization before any read, Zod input validation (Day, TimeHHMM, isStartBeforeEnd), version/entry/venue existence checks, compare-and-set write that re-verifies the version is still DRAFT and the entry still unlocked inside the transaction, audit logging, and a typed result covering success, invalid input, forbidden, missing records, locked entries, stale updates, and internal errors. Conflicts are not blocked — a clash move remains in the DRAFT and the subsequent validator reports it. No UI, no add/delete, no publication, no migration.
- Files changed: src/server/draftMove.ts (new), src/server/draftStorePrisma.ts (modified — added findEntry, findVenueById, moveEntry + createDraftMoveStore), src/server/__tests__/draftMove.test.ts (new, 31 tests), PROGRESS.md, DECISIONS.md
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint "No ESLint warnings or errors" plus the known `next lint` deprecation notice; vitest 617 tests passed across 32 files (31 new); seed check 11 tests passed. `npm run build`: compiled successfully in 5.3s, 17/17 pages generated, exit 0.
- Decisions: recorded in DECISIONS.md (M3-T2b1 a–f) — authorization before any read; Zod input validation with existing domain schemas; only day/start/end/venueId are writable (teachingId, versionId, locked never taken from the request); compare-and-set inside a Prisma transaction re-checks version status is DRAFT and entry locked=false, so a concurrent publish or lock fails as STALE without modifying data; the move result never claims conflict-free (conflicts exposed through the M3 validator re-run by the caller); the move store shares the read store's Prisma adapter via a single `buildDraftStore()` returning `DraftValidationStore & DraftMoveStore`.
- Known problems: the Prisma move adapter (`moveEntry`) has no automated database-backed test (same as every earlier Prisma store) — it is exercised by typecheck/build only. No page or route handler consumes `performDraftMove` yet — that is M3-T2b2 (UI) or M3-T2c.
- Next suggested task: M3-T2b2 (officer draft editor UI consuming the loader and move operation with inline violations)
## 2026-11-05 M3-T2b1a Prevent stale draft moves from overwriting newer changes
- Done: Upgraded `performDraftMove()` to true optimistic concurrency — the request now carries the expected previous schedule (`expectedDay`/`expectedStart`/`expectedEnd`/`expectedVenueId`), the expected values are validated with the existing domain Zod schemas as untrusted input, the server pre-check compares them with the stored entry and returns `STALE` on any mismatch, and the Prisma transaction's compare-and-set `updateMany` now also matches the expected day/start/end/venueId on top of `id + versionId + locked=false` (the transactional DRAFT-version status re-check is retained). The audit row is created only when the conditional update actually updates a row, so a rejected stale move writes nothing; moving a DRAFT entry into a clash still succeeds and the M3 validator still reports the violation. New tests: 15 added (31 → 46) — expected-mismatch `STALE` per field, two sequential moves from one original state (first ok, second `STALE`, entry and audit untouched by the loser), expected-field input validation, accurate audit transition text, plus a real-Prisma suite running the adapter's transaction against a fresh isolated SQLite file in the OS temp directory (never `prisma/dev.db`): accepted move with audit, stale move after a competing change, sequential double move, and direct `moveEntry` compare-and-set rejections for a locked entry and a PUBLISHED version — each asserting the entry is unchanged and zero audit rows exist.
- Files changed: src/server/draftMove.ts, src/server/draftStorePrisma.ts, src/server/__tests__/draftMove.test.ts, PROGRESS.md, DECISIONS.md
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint "No ESLint warnings or errors" plus the known `next lint` deprecation notice; vitest 632 tests passed across 32 files (draftMove.test.ts 31 → 46); seed check 11 tests passed. `npm run build`: compiled successfully in 4.5s, exit 0. The isolated-DB suite ran `npx prisma db push --skip-generate` with an injected `DATABASE_URL=file:<temp>` and deleted only its own temp database file in `afterAll` (`fs.unlinkSync` of `os.tmpdir()/tams-move-test-<ts>.db`); `prisma/dev.db` was never opened.
- Decisions: recorded in DECISIONS.md (M3-T2b1a a–f) — expected previous schedule as the compare-and-set token instead of a new version column (no migrations allowed); two-layer check (clear-message pre-check + transactional `updateMany` as the final guard); expected fields validated with the same schemas as proposed fields; audit written only after `count > 0`; the fake store mirrors all four compare-and-set predicates so orchestration tests cannot drift from the adapter.
- Known problems: the observed guarantee is "a committed move never silently overwrites a newer one" — two officers submitting against the same loaded state cannot both land. True simultaneous-writer execution (two concurrent connections racing one commit) is not exercised: the in-transaction paths (locked entry, PUBLISHED version, schedule mismatch) are proven by direct `moveEntry` calls against the isolated SQLite database, and the pre-check path by sequential re-submission. Authorization-before-read is proven by fake-store call counting only, not against the real database. SQLite `updateMany` matching all four schedule columns relies on the stored strings being in the same format as `TimeHHMMSchema`/`DaySchema` values — true for seeded and validator-written data, but a corrupt legacy format would surface as `STALE` rather than a clear error.
- Next suggested task: M3-T2b2 (officer draft editor UI consuming the loader and move operation with inline violations)
## 2026-11-05 M3-T2c1 Secure server action for moving draft timetable entries
- Done: Added `moveDraftEntryAction` ("use server", src/app/officer/draft/actions.ts) — the authenticated officer's browser entry point to the existing `performDraftMove()` service via `createDraftMoveStore()`. Order: same-origin check → session → strict ten-key shape validation → service; the typed `DraftMoveResult` (ok, STALE, ENTRY_LOCKED, NOT_DRAFT, FORBIDDEN, INVALID_INPUT, not-found kinds, INTERNAL_ERROR) is passed through unchanged. No UI, no validation/concurrency/authorization duplication, no new dependencies or migrations.
- Files changed: src/app/officer/draft/actions.ts (new), src/server/__tests__/draftMoveActions.test.ts (new, 28 tests), DECISIONS.md, PROGRESS.md
- Verify: PASS — see pasted output in the task report (typecheck, lint, vitest, seed:check) and `npm run build`.
- Decisions: recorded in DECISIONS.md (M3-T2c1 a–d) — thin boundary over the accepted service; `.strict()` schema rejects forged keys (role/userId/actorId/locked/…) outright rather than silently stripping them; refusals happen before `createDraftMoveStore()` is called; unexpected errors log the message only and return `INTERNAL_ERROR`; success returns `{ok, entryId, versionId}` only — the editor must reload via `loadDraftForValidation()` (requirement #9).
- Known problems: the action has no page consumer yet (the draft editor is the next task); the Prisma adapter path is exercised by typecheck/build and the existing isolated-DB suite, not by these action tests (which use the established fake-store + module mocks).
- Next suggested task: M3-T2b2 (officer draft editor UI consuming `loadDraftForValidation` and `moveDraftEntryAction`)
## 2026-11-05 M3-T2b2 Officer draft editor page
- Done: Added `/officer/draft` — the officer draft editor. A guarded server page (requireAction("EDIT_DRAFT"), then loadDraftForValidation re-decides) renders one DRAFT version: ?version= GET picker listing stored DRAFT versions, entry rows (unit code, current schedule, venue code), inline plain-language violations per row, an amber "validation incomplete" notice rendering missingContext, and a fixed refusal message per loader kind. Each unlocked row has a MoveForm (day select, start/end time inputs, venue select) posting to moveDraftEntryAction; proposed values are local state while the expected* concurrency values always come from the latest server render; after success or STALE the client calls router.refresh() so the conflict summary is always a fresh server validation (requirement #9). Locked rows show a "Locked" badge and no form. Flipped the draft-editor menu item built → true. No add/delete, no publish, no new dependencies.
- Files changed: src/app/officer/draft/page.tsx (new), src/app/officer/draft/DraftTable.tsx (new), src/domain/menu.ts, src/domain/__tests__/menu.test.ts, DECISIONS.md, PROGRESS.md (6 files — cap raised with explicit user approval for this task)
- Verify: PASS — `npm run verify`: typecheck 0 errors; lint "No ESLint warnings or errors" plus the known `next lint` deprecation notice; vitest 660 tests passed across 33 files; seed check 11 tests passed. `npm run build`: compiled successfully in 5.6s, /officer/draft listed as a dynamic route. Browser pass (dev server on port 3004, then stopped): officer login → editor shows 10 entries and the 2 planted conflicts with exact messages; moving SOEN 410 into the FRI 10:00 CR1 slot succeeded, the table reloaded showing "4 hard violations" with "CR1 is used by two classes at the same time (FRI 10:00-11:00)." and "Lecturer teaches two classes at the same time (FRI 10:00-11:00)." inline, and the success line never claimed conflict-free; moving it back to THU restored the seeded 2-violation state (proving sequential expected-value refresh); a STUDENT session navigating to /officer/draft was redirected to /forbidden; the officer home menu now links "Draft editor".
- Decisions: recorded in DECISIONS.md (M3-T2b2 a–f) — ?version= picker with exact-match DRAFT ids; expected* taken from server props, never client state; fixed message tables per typed refusal; incomplete/locked/unresolved rows rendered visibly; pairwise violations shown on the earlier entry (the message names both classes).
- Known problems: the UI two-session STALE race was not exercised in the browser (single-page tool) — it is covered by the M3-T2b1/T2c1 fake-store tests and the isolated-DB suite instead. The browser test wrote two TIMETABLE_ENTRY_MOVE audit rows for the round-trip move (entries themselves were restored to the seeded schedule). No component tests exist (no React testing library in the prototype).
- Next suggested task: M3-T2b3 (draft editor add/remove entry) or M4-T2 (generate-draft action creating a DRAFT version)
