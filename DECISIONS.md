# DECISIONS.md
(Record every technical decision: date · decision · reason · alternative rejected.)

## 2026-10-26 Signed-Cookie Sessions Instead of Auth.js (M1-T3a)
- **Decision**: Implemented custom signed-cookie sessions using Node built-in `crypto` (HMAC-SHA256) rather than Auth.js (next-auth).
  - Token format: `base64url(JSON payload)` + `.` + `base64url(HMAC-SHA256 signature)`.
  - Session duration: **8 hours** (SESSION_DURATION_MS = 28 800 000 ms). design choice, to be confirmed with the university.
  - No login lockout in the prototype — lockout logic is a server-side rate-limit concern deferred to the production system.
  - `authenticate()` always runs `verifyPassword` even when the email is not found to prevent timing attacks that would reveal whether an email exists.
- **Reason**: Auth.js adds ~80 kB of dependency surface, requires adapter config, and hides the session model behind abstractions. A custom 120-line implementation is auditable, requires zero new packages, and satisfies the prototype's "no external dependencies" rule (AGENTS.md §2).
- **Alternative rejected**: Auth.js credentials provider — rejected to avoid new dependency and opaque session management.

## 2026-10-26 Planted Conflicts Refined to Single-Violation (M1-T2b)
- **Decision**: Corrected planted timetable entries in `src/domain/seedData.ts` and enhanced seed integrity tests in `src/domain/__tests__/seed-check.test.ts`:
  - Shifted Lecturer A's unavailability row `la-A-1` from MON 08:00-10:00 to MON 15:00-17:00 so `entry-planted-venue-1` (MON 08:00-09:00) isolates only the venue overlap and carries no lecturer unavailability violation.
  - Relocated `entry-planted-lecturer-2` (group size 50) from `venue-CR3` (capacity 40) to `venue-CR1` (capacity 60) at TUE 10:00-11:00, resolving the unintended capacity shortage while preserving the lecturer overlap with `entry-planted-lecturer-1`.
  - Added a production check in `prisma/seed.ts` exiting with code 1 if `process.env.NODE_ENV === "production"` before database operations.
  - Added pure `timesOverlap` helper and assertions in `seed-check.test.ts` verifying that each entry satisfies capacity, venue type, and availability constraints, with exactly two planted overlap pairs across the schedule and zero group overlaps.
- **Reason**: Timetable validation testing requires clean isolation where each planted defect triggers exactly one violation type without extraneous rule failures.
- **Alternative rejected**: Leaving multi-violation planted entries, which conflates validator rule test diagnostics.


## 2026-10-26 Deterministic Seed Data & Password Hashing (M1-T2)
- **Decision**: Implemented deterministic pure seed data in `src/domain/seedData.ts` and idempotent seeding in `prisma/seed.ts` using Node built-in `crypto` (`scrypt`) formatted as `scrypt$<salt>$<hash>`. Configured `Teaching` records with `sessionsPerWeek = 3` and `sessionLength = 1` (hours) as an explicit stand-in for assumption A15 (assumed 2+1 contact hour session split) until confirmed at the Kisii University stakeholder meeting. Added `tsx` as devDependency to execute seed scripts via Prisma and npm.
- **Reason**: Pure seed definitions guarantee test determinism and offline integrity verification without DB dependencies; scrypt satisfies zero-external-dependency requirement for password hashing; uniform 1-hour sessions simplify prototype draft generation and conflict validation while awaiting stakeholder clarification on contact hour split.
- **Alternative rejected**: External hashing dependencies (bcrypt/argon2); dynamic random IDs in seed data; hardcoding assumptions without traceability.

## 2026-10-26 Domain Model Field & Relation Patches (M1-T1b)
- **Decision**: Added `User.studentGroupId`, `Issue.reportedBy`, `RescheduleRequest.requestedBy`, `RescheduleRequest.decisionNote`, and `Submission.semester` to Prisma schema and updated PROTOTYPE_SPEC §6:
  - `User.studentGroupId`: Relates student users to `StudentGroup` (with reverse `StudentGroup.students User[]`) for attendance eligibility verification (§8, M7-T1) and default student timetable views (M4-T4).
  - `Issue.reportedBy`: Named relation (`IssueReporter`) linking issues to reporting user for role permission enforcement (§8) and status auditability (M6-T2).
  - `RescheduleRequest.requestedBy`: Named relation (`RescheduleRequester`) tracking the lecturer submitting reschedule requests for their own classes (§8, M6-T1).
  - `RescheduleRequest.decisionNote`: Stores officer decision notes / rationale when approving or rejecting reschedule requests.
  - `Submission.semester`: Tracks target academic semester for department submissions (defaulting to 1) to align with semester-scoped timetabling.
- **Reason**: Closes relational gaps identified prior to seeding (M1-T2) and authorization guards (M1-T3), ensuring referential integrity and foreign key indexing without altering business logic boundaries.
- **Alternative rejected**: Inferring student groups dynamically or omitting requester/reporter audit links; overloading unstructured reason/note fields.

## 2026-10-26 Domain Model Schema & SQLite Representation (M1-T1)
- **Decision**: Modeled all entities from PROTOTYPE_SPEC §6 with Prisma relations, foreign key indexes, and a composite unique constraint on `AttendanceRecord(sessionId, studentId)`. Enum-like attributes (roles, venue types, statuses, attendance modes, verdicts, days) are stored as standard `String` fields with Zod runtime schemas in `src/domain/types.ts`, and list attributes (`Venue.facilities`) as JSON strings accompanied by serialization/parsing helpers.
- **Reason**: Complies with prototype SQLite constraints (spec §4: no Prisma enums and no scalar lists in SQLite) and ensures seamless migration to PostgreSQL in M9-T1 without database-specific syntax lock-in.
- **Alternative rejected**: Prisma unsupported scalar lists or enum types; storing unvalidated string values directly without domain Zod schemas.

## 2026-10-29 Stateless signed-cookie revocation (M1-T3b2)
- **Decision**: Signed stateless session cookies cannot be revoked before they expire; logout (`endSession()`) only deletes the cookie from the client. Accepted for the prototype; to be revisited with a server-side session table at M9.
- **Reason**: The prototype has no session store, so deleting the cookie is the only revocation mechanism available without a database lookup on every request. Acknowledged limitation: a stolen cookie stays valid until expiry (8 hours, `SESSION_DURATION_MS`).
- **Alternative rejected**: Server-side session table with revocation checks — deferred to M9-T1 (PostgreSQL switch).

## 2026-10-29 Access decision and server guards (M1-T3c-2)
- **Decision (a)**: The OWN_CLASSES scope compares `resource.ownerUserId` with `actor.id`, where `actor.id` is the `User.id`. Callers must pass `teaching.lecturer.userId` (the `User.id` linked to the Lecturer row via `Lecturer.userId`), not the Lecturer row id, as the resource owner id for OWN_CLASSES actions (OPEN_ATTENDANCE, REQUEST_RESCHEDULE, VIEW_ATTENDANCE_REPORT).
  - Reason: `canAct()` compares user ids (src/domain/permissions.ts); a Lecturer surrogate id would never match the actor's `User.id`.
- **Decision (b)**: No Next.js middleware is used for authorization. Middleware runs on the Edge runtime where Prisma and Node crypto are unavailable, so `requireUser`, `requireAction`, and `authorizeApi` (src/server/guards.ts) are called per page / route handler / server action in the Node runtime instead.
  - Reason: Keeps session verification (database + signed cookies) in the same Node runtime and avoids Edge-runtime failures at request time.

## 2026-10-26 Linter Tooling (M0-T2)
- **Decision**: next lint is deprecated in Next.js 16; staying on ESLint via next lint for the prototype.
- **Reason**: Standard Next.js lint runner works cleanly with current config and avoids introducing unnecessary codemod overhead or additional scripts during prototype phase.
- **Alternative rejected**: Migrating to standalone ESLint CLI command at this time.

## 2026-10-26 Baseline Stack Initialization (M0-T1)
- **Decision**: Configured Next.js App Router with TypeScript strict mode, Vitest unit test runner with `@/*` alias, Tailwind CSS, ESLint, and Prisma with SQLite (`dev.db`).
- **Reason**: Matches the prototype stack specification §4 and repository layout §5. Fast to run locally without Docker for prototype demos.
- **Alternative rejected**: PostgreSQL with Docker Compose at this stage (rejected per spec §4 and §11 until M9-T1).

## 2026-10-29 Permission matrix (M1-T3c-1)
- **Decision**: Implemented `src/domain/permissions.ts` with a deny-by-default, scope-based permission matrix per PROTOTYPE_SPEC §8: 17 actions × 6 scopes × 6 roles in one explicit `Record<UserRole, Record<Action, Scope>>` table (`PERMISSION_SCOPE`) with no defaults or fall-through; `permissionScope()` returns NONE for unknown roles/actions cast in at runtime; `canAct()` enforces actor-null → false, NONE → false, ALL → true, and per-scope checks for OWN_DEPARTMENT / OWN_CLASSES / OWN_GROUP / SELF, denying on missing or null required resource fields — never throws; `allowedActions()` lists non-NONE actions for menus.
- **Reason**: Pure, testable domain logic (AGENTS.md §3) that the server can enforce on every route/action; the Record type makes every cell compile-time accounted for.
- **Alternative rejected**: Deriving scopes at runtime from role/resource shape; implicit default scopes.
- **Note**: In the prototype ADMIN is granted only MANAGE_USERS (plus timetable/venue-status viewing); ADMIN does not manage venues, submissions, or timetables.

## 2026-11-01 Role-based menus and guarded demo account switch (M1-T3c-4)

- **Decision (a): Role-based menus derived from the permission matrix.**
  `src/domain/menu.ts` defines `MENU_ITEMS` (all `built: false`; the flag is
  flipped to `true` as each corresponding page is delivered) and
  `menuForRole(role)`, which returns, in list order, the items whose
  `permissionScope(role, action)` is not "NONE" — unknown roles yield an
  empty menu and nothing ever throws. `PUBLISH_TIMETABLE` and
  `MANAGE_SHARED_VENUES` have no menu entries; they live inside other pages.
  - Reason: menus stay consistent with the enforceable permission matrix.
    The UI is never a security boundary — every page, route handler, and
    server action enforces authorization itself.
- **Decision (b): Demo account switch at POST /api/demo/switch with three protections.**
  (1) 404 `{"error":"not_found"}` unless `isDemoEnabled(DEMO_MODE, NODE_ENV)`
  (pure function in src/server/demoMode.ts: true only when DEMO_MODE is
  exactly "true" and NODE_ENV is not "production"); (2) 403
  `{"error":"forbidden"}` on same-origin check failure via `isSameOriginRequest`;
  (3) only existing users with a `@demo.tams.test` email and a valid role are
  sessioned — unknown ids and non-demo accounts get one generic
  `/login?e=bad_request` redirect, preventing account enumeration. No password
  is read or accepted, nothing is logged, and every redirect path is a
  hard-coded constant.
  - Reason: the switch is a walkthrough convenience, so it must never be
    reachable in production, never be callable cross-site, and never reveal
    which accounts exist.

## 2026-11-01 Role home page, demo switcher, and guarded placeholders (M1-T3c-5)
- **Decision**: `/officer` (`await requireAction("EDIT_DRAFT")`) and `/admin` (`await requireAction("MANAGE_USERS")`) are guard-probe placeholders rendering "Officer area (placeholder)" / "Admin area (placeholder)"; they will become real dashboards in later milestones. Every page enforces its own guard — layouts are not a security boundary (AGENTS.md §3).
- **Decision**: `DemoSwitcher` renders only when `isDemoEnabled(DEMO_MODE, NODE_ENV)` — DEMO_MODE exactly "true" and NODE_ENV not "production" — and returns `null` otherwise, so the demo switcher never shows in production and renders nothing at all when demo mode is off.
- **Decision**: The home page never calls `requireAction`; it renders exactly `menuForRole(user.role)` items in list order, with unbuilt items greyed out ("Coming soon") rather than links.

## 2026-11-01 Cleanup before merging M1 (M1-T3c-6)
- **Decision**: `cookies()` must be called outside the try/catch in `getCurrentUser()` (src/server/auth.ts). Next.js throws a special error from `cookies()` during static analysis, and catching it would swallow dynamic-rendering signals. Comment added to enforce this.
  - Reason: Prevents silently swallowing Next.js dynamic-rendering errors while preserving the existing catch behaviour (log prefix + message, return null) for all other failures.
- **Decision**: Role labels live only in `src/domain/roles.ts` (`ROLE_LABEL` record + `roleLabel()`). Duplicate maps in layout.tsx, page.tsx, and DemoSwitcher.tsx were removed and replaced with imports. `roleLabel()` never throws — it returns the raw string for unknown roles and uses `Object.hasOwn` so `"__proto__"` / `"toString"` are safe.
  - Reason: Single source of truth for role labels; prevents drift between UI copies.

## 2026-11-01 Same-origin auth guard and demo credentials (M1-T3c-3)
- **Decision (a): No login rate limiting in the prototype.** Login attempts are not throttled and there is no lockout; this remains a server-side production concern.
  - Reason: Keeps the prototype dependency-free and simple for the demo; rate limiting does not affect the stakeholder walkthrough.
- **Decision (b): All demo accounts share one password and all data is synthetic — never deploy publicly.** Seed names, registration numbers, and contacts are made up, and a shared password is a known demo weakness.
  - Reason: Honesty about prototype limitations; prevents the demo being mistaken for real university records or exposed on the public internet.
- **Decision (c): Cross-site protection uses the Origin header with a Sec-Fetch-Site fallback instead of CSRF tokens.** `isSameOriginRequest()` (src/server/origin.ts) guards POST /api/auth/login and POST /api/auth/logout before any other logic.
  - Reason: Simpler than issuing and validating CSRF tokens while still rejecting cross-site form POSTs; Origin/host comparison covers browsers that send Origin, Sec-Fetch-Site covers those that do not.

## 2026-11-01 Venue register schema, write rules and filters (M2-T1a)
- **Decision**: Venue write access requires the actor to hold the relevant permission over EVERY owner involved — the current owner (EDIT only) and the proposed owner — decided purely by `canAct()` from `src/domain/permissions.ts`; no role names are hard-coded in `venueRules.ts`. A null (shared) owner requires `MANAGE_SHARED_VENUES`; a department id requires `DECLARE_VENUE` scoped to `{ departmentId }`. Consequence: a department rep can edit only its own department's venues, cannot hand a venue to another department, cannot make an owned venue shared, and cannot edit a shared venue; the timetabling officer may do all of these.
- **Decision**: `ALLOWED_FACILITIES = ["projector", "computers", "whiteboard", "accessible"]`; venue input is validated with Zod (code trimmed and uppercased, 2–10 chars, A-Z / 0-9 / "-" only; capacity integer 1–1000 rejecting decimals, 0, negatives and numeric strings; facilities deduplicated and capped at 4; status defaults to ACTIVE; ownerDepartmentId 1–100 chars or null for a shared venue). (`src/domain/venueSchema.ts`)
- **Decision**: Changing the capacity or type of a venue already used in timetable entries must trigger re-validation of those entries (capacity/type rules); this is deferred to the M3 conflict validator and is not enforced in M2.

## 2026-11-01 Venue register rows and summary (M2-T1b2)
- **Decision**: `canEdit` on each register row is computed with `decideVenueWrite` from `src/domain/venueRules.ts`, so the UI edit hint and the server-side write rule cannot disagree (`src/domain/venueRegister.ts`).
- **Decision**: the register shows all venues to every allowed role (read) while editing stays per-record; ownership gates the edit column, never visibility.
- **Decision**: Humanities is deliberately included in `summariseVenues` output with 0 venues to illustrate departments without rooms (spec §10: "plus one department that owns no shared rooms").
- **Reason**: Read access must not leak per-record authorization; a single source of truth for the write rule avoids UI/server divergence; a zero-venue department makes the owned-versus-shared contrast visible at the walkthrough.

## 2026-11-01 Any-access page decision, page guard and filter parsing (M2-T1b1)
- **Decision**: Page entry uses `decideAnyAccess` (permission scope not NONE) rather than `decideAccess`, because an OWN_DEPARTMENT scope needs a resource and would lock department reps out of the venue register page before they have picked a department. (`src/domain/access.ts`, `src/server/guards.ts`)
  - Reason: `declareVenue` for a department rep is scoped to OWN_DEPARTMENT; at page entry no venue/resource exists yet, so `decideAccess` would return FORBIDDEN for every department rep.
- **Decision**: Per-record permission is always rechecked in the server action that changes data, using `decideAccess` or the action-specific rule function (e.g. `decideVenueWrite`); `decideAnyAccess` / `requireAnyAction` never authorizes a write by itself.
  - Reason: page entry is not a security boundary; layouts do not re-run on client navigation.
- **Decision**: Filter query parameters are parsed leniently — invalid or unknown values are silently ignored, never an error — because they come from the browser address bar. Repeated keys (array values) and inherited keys (`__proto__`, `toString`) are ignored. (`src/domain/venueFilterParams.ts`)
  - Reason: address-bar input is user-controlled and must never surface a 400/500 for a mistyped filter; dropping invalid values keeps the list page usable.

## 2026-11-01 Venue ownerDepartmentId required and capacity parsed as number (M2-T1a2)
- **Decision**: `ownerDepartmentId` in `VenueInputSchema` is required: a trimmed 1–100 character string or `null` (shared venue) is accepted, but a missing field (`undefined`) is rejected — explicit `null` means shared, a missing field must never silently create a shared venue.
- **Reason**: `venueRules.ts` decides write access per owner; a silently shared venue would bypass department scoping.
- **Decision**: The venue form action must convert `capacity` from text to a number before validation — HTML form inputs send strings, but `VenueInputSchema` requires a number.
- **Alternative rejected**: Keeping `.nullish().default(null)` on `ownerDepartmentId`, which would silently turn a missing field into `null` (shared).

## 2026-11-01 Venue register page (M2-T1b3)
- **Decision**: The `/venues` page entry uses `requireAnyAction("DECLARE_VENUE")`, so only roles with a venue-declare scope (officer, department rep) see the Venue register menu item and page, while every signed-in role can read venue status elsewhere. (`src/app/venues/page.tsx`)
- **Decision**: The summary strip counts ALL venues (`summariseVenues` over all rows), while the table respects the active filters (`filterVenues(rows, filter)`); "Showing N of M" reports the filtered count N of the total M.
- **Decision**: `.clinerules` now contains only a pointer to `AGENTS.md` so the two rule files cannot drift apart.
- **Reason**: `DECLARE_VENUE` is OWN_DEPARTMENT-scoped for department reps, so `requireAction` (which requires a resource) would lock them out at page entry; per-record write permission is still rechecked in the data-changing action (M2-T1c). A single rules source avoids drift; separating the all-venues summary from the filtered table matches the spec.
- **Alternative rejected**: `requireAction("DECLARE_VENUE")` — rejected because it would redirect department reps to `/forbidden` at page entry.


## 2026-11-02 File-size rule relaxed; explicit owner; pure form parser (M2-T1c1)
- **Decision**: File size is now a guideline ("aim for about 300 lines, up to about 400 if cohesive") rather than a hard cap; tests, schemas, seed data and tables are exempt. Split by responsibility when near the target; never delete or shorten code, comments, validation, tests or accessibility only to meet a line target.
  - Reason: a hard cap made the agent compress code; the target is a guideline with split-by-responsibility.
- **Decision**: The venue `owner` form field must be chosen explicitly; "shared" is a deliberate sentinel value (`SHARED_OWNER_VALUE = "__SHARED__"`), never the default. A missing/empty/whitespace/non-string owner is an error "Choose an owner or Shared".
  - Reason: `venueRules.ts` decides write access per owner; a silently shared venue would bypass department scoping.
- **Decision**: The form parser (`src/domain/venueForm.ts`) is pure and never throws; the server action will re-run `decideVenueWrite` on the server.
  - Reason: business logic stays pure and testable; authorization is always rechecked server-side.
## 2026-11-02 Venue write logic and audit helper (M2-T1c2)
- **Decision**: Write logic takes storage as a parameter so every permission case is unit tested without a database.
- **Decision**: The current owner always comes from the database, never from the form.
- **Decision**: The role-level check runs before validation so forbidden users learn nothing about the form.
- **Decision**: Every venue write creates an audit row in the same transaction.
- **Decision**: Changing a venue's capacity or type does NOT yet re-check existing timetable entries, which the M3 validator will report as violations (known limitation).

## 2026-11-02 Venue write transaction owner-read limitation (M2-T1c2b)
- **Decision**: The current owner is read before the write transaction, so two simultaneous edits could conflict (acceptable for a single-user prototype; revisit at M9 with a version column or a check inside the transaction).

## 2026-11-02 Venue submission action and owner options (M2-T1c3a)
- **Decision**: The venue server action is a thin wrapper; parsing, authorization, validation, and write behavior remain in tested functions.
- **Decision**: The `op` and `venueId` fields come from the form and are untrusted; the server validates them and re-checks authorization against the stored venue before writing.
- **Decision**: Owner dropdown options are filtered through `decideVenueWrite`, so the UI cannot offer an owner the server would refuse.
- **Decision**: Success and not-found outcomes use fixed notice keys in the address bar, never raw text.

## 2026-11-02 Venue create and edit pages (M2-T1c3b)
- **Decision**: `VenueForm` is the only client component in the venue write flow and receives only serialisable form values and owner options.
- **Decision**: The hidden `op` and `venueId` fields are untrusted; the action validates them and checks authorization against the stored venue. The edit page also runs `decideVenueWrite` for the stored venue before rendering.
- **Decision**: Capacity uses a text input with `inputMode="numeric"` and the form uses `noValidate`, keeping server validation messages authoritative while preserving invalid input for correction.
- **Decision**: A sole permitted owner is preselected; a shared owner is never selected by default.
- **Decision**: Register notices are selected from a fixed key-to-message table; unrecognized query values render no message.
- **Decision**: `__SHARED__` is the explicit form sentinel for choosing a shared venue.