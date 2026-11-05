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

## 2026-11-02 Submission write pipeline and compare-and-set transition guard (M2-T2b)
- **Decision (a)**: The write logic accepts a storage interface instead of importing Prisma or Next.js so every permission and state case is unit-tested in isolation without a database.
  - **Reason**: `performSubmissionWrite()` is pure domain logic at the server boundary; a test can supply a fake store, test role checks and stale races, and the real Prisma-backed store remains a thin adapter.
- **Decision (b)**: Department and status are always resolved from the store record, never from the request payload.
  - **Reason**: The action is authorized against the currently stored department and state, which prevents an attacker from forging department ownership or bypassing transitions via an unsafe request object.
- **Decision (c)**: The role-level check runs before the lookup so an unauthorized actor cannot probe a submission id or learn whether it exists.
  - **Reason**: `decideAnyAccess(actor, permission)` happens before `findSubmission()`, returning `FORBIDDEN` for accounts without permission, even when the id is unknown.
- **Decision (d)**: The state transition uses compare-and-set in the database `WHERE` clause (`status = expectedStatus`), and the service treats a stale status as `CONFLICT`.
  - **Reason**: Double clicks and simultaneous approvals cannot both succeed; a lost race is rejected cleanly without writing a second audit record for the stale transition.
- **Decision (e)**: `Submission.note` and `reviewerId` hold only the latest values, while the audit log keeps the full history and resubmission clears the older note and reviewer.
  - **Reason**: The current submission reflects the latest review outcome, but every transition remains traceable in `AuditLog` for human review and debugging.
- **Decision (f)**: Submission ids are not treated as secret in the prototype, so `NOT_FOUND` for a missing id and `FORBIDDEN` for another department's known id are acceptable differences when the caller is not authorized.
  - **Reason**: The spec emphasises role enforcement and auditability over hiding the existence of a valid submission from a different department; the prototype is intentionally small and explicit about authorization boundaries.
- **Alternative rejected**: Embedding the department or status in the request and trusting it; this creates a tampering vector and prevents reliable compare-and-set semantics.

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

## 2026-11-02 Submission transition rules and officer overview (M2-T2a)
- **Decision**: `VIEW_SUBMISSIONS` is officer-only; department representatives and approvers use their own submission pages.
- **Decision**: `APPROVED` is final in the prototype; whether submissions can be reopened is a question for the meeting.
- **Decision**: Permission is checked before submission state and note validation so unauthorised users learn nothing about either.
- **Decision**: Returning a submission requires a note of at least 3 trimmed characters.
- **Decision**: `Submission.note` holds only the latest note; the audit log keeps the history.
- **Decision**: `availableSubmissionActions` derives visible actions from the same transition decisions the server accepts.

## 2026-11-02 Submission views and teaching loaders (M2-T2c1)
- **Decision**: Add a Mathematics approver to support the seeded Mathematics submission workflow.
- **Decision**: Submission visibility is checked per record and per view using existing `canAct` permissions.
- **Decision**: Officers receive an overview; department representatives and approvers see only records they are authorized to access.
- **Decision**: Teaching lists provide read-only context.
- **Decision**: Invalid statuses are dropped.
- **Decision**: Status labels, tones, and notice messages use the fixed mappings specified for this task.
- **Decision**: This task explicitly permits eight files, overriding the normal five-file limit.

## 2026-11-04 Lecturer availability semantics and pure rules (M2-T3a)
- **Decision**: Lecturers record periods when they are **unavailable** to teach; every row the form writes stores `available: false`. Rejected: positive availability windows — all four seeded `LecturerAvailability` rows use `available: false`, the seed integrity tests already read them as "must not be scheduled", and the hard constraint in PROTOTYPE_SPEC §7 is named `LECTURER_UNAVAILABLE`.
- **Decision**: A row with `available: true` restricts nothing and is dropped by `unavailablePeriodsFromRecords()`; the prototype never writes such a row.
- **Decision**: Periods are half-open ranges, so adjacent periods (13:00-14:00 then 14:00-15:00) are allowed while any shared minute is rejected. An exact repeat is reported as `DUPLICATE` instead of `OVERLAPS` so the UI can name the row the lecturer already saved.
- **Decision**: "Start must be earlier than end" is only reported when both times are well-formed, so a malformed time does not also produce an order error.
- **Decision**: Malformed stored rows can never create a conflict — `timesOverlap()` requires both ranges to be well-formed HH:MM pairs **and** positively sized (`start < end`), so a corrupt, reversed or zero-length range overlaps nothing. A reversed query such as 15:00-12:00 therefore cannot report a false overlap against a wide saved period like 10:00-20:00.
- **Decision**: No reason field and no restriction to the 08:00-17:00 window in this form: the model has no reason column, and "outside allowed slots" belongs to the validator (ASSUMPTION-9 covers the MON-FRI day set only).
- **Decision**: `findUnavailableConflict()` is the rule M3-T1's validator will call to produce `LECTURER_UNAVAILABLE`; M2-T3 provides the periods and the loader only, and does not claim validator integration.

## 2026-11-04 Lecturer availability permissions (M2-T3b)
- **Decision**: Two separate actions: `SET_LECTURER_AVAILABILITY` (LECTURER → SELF, nobody else) and `VIEW_LECTURER_AVAILABILITY` (LECTURER → SELF, OFFICER and ADMIN → ALL). Rejected: one combined action — a single matrix cell cannot express "may read another lecturer's periods but never write them".
- **Decision**: Read is not write. Officers and admins hold no `SET` cell at all, so even passing their own user id as the subject cannot authorize a write; lecturers remain the only users who create, edit or remove availability records. Rationale: timetable preparation and the M3 `LECTURER_UNAVAILABLE` check need visibility, and visibility without mutability keeps the record accountable.
- **Decision**: ADMIN → ALL for the read action matches the established ADMIN convention in this matrix (system-wide over `MANAGE_USERS` and the `VIEW_*` actions, `NONE` for every operational write such as `DECLARE_VENUE`, `EDIT_DRAFT`, `PUBLISH_TIMETABLE`), so no new interpretation of ADMIN was introduced.
- **Decision**: Both actions are keyed on `Resource.subjectUserId`, the lecturer's **user** id rather than `Lecturer.id`. The server resolves the authenticated user's own lecturer row, so a lecturer id or user id supplied by the browser cannot redirect ownership.
- **Decision**: DEPT_REP, APPROVER and STUDENT are NONE for both actions. Whether a department should see its own lecturers' constraints is a question for the meeting, not a prototype default.
- **Decision**: The two actions are appended to `ACTIONS` (18 → 20) so every existing role's `allowedActions` order is preserved; `menu.ts` lists its items explicitly, so no navigation changes in this task.

## 2026-11-04 Lecturer availability page, audienceRoles, and no officer view (M2-T3d)

- **Decision (a): The availability page guards on `SET_LECTURER_AVAILABILITY`, not `VIEW_LECTURER_AVAILABILITY`.** The page is a lecturer's write workspace (add/remove own periods), so the entry guard is the SELF-scoped write action. Officers and admins hold `VIEW_LECTURER_AVAILABILITY` with ALL scope, but that permission exists so `loadAllLecturerAvailability` can feed the M3 conflict validator server-side — not so officers get a menu entry or a read-only UI page. An officer who navigates to `/lecturer/availability` directly is redirected to `/forbidden`. The read inside the page still re-checks `VIEW_LECTURER_AVAILABILITY` against `user.id` for defence in depth.
  - Reason: the VIEW permission serves the validator pipeline, not a dedicated officer-facing page. The M3-T2 draft editor will surface lecturer unavailability contextually as `LECTURER_UNAVAILABLE` violation messages where the officer actually needs it — in the draft they are editing. A separate read-only availability list page would be scope beyond the demo script (§12) and is not needed for the prototype to tell its story.
  - Alternative rejected: a read-only officer availability view at the same route — adds a second rendering mode, a second guard path, and a page the demo script does not exercise. If the meeting says officers need it, it becomes a new task.

- **Decision (b): `audienceRoles?: readonly UserRole[]` on `MenuItem` narrows the sidebar independently of the permission matrix.** `menuForRole` still filters by `permissionScope(role, action) !== "NONE"` first, then applies `audienceRoles` if set. The "My availability" item uses `action: "VIEW_LECTURER_AVAILABILITY"` (so the permission check passes for officers/admins with ALL scope) but `audienceRoles: ["LECTURER"]` so only lecturers see it in the sidebar.
  - Reason: the permission matrix expresses what the server enforces (officers may read any lecturer's availability for validation). The sidebar expresses what each role does in the UI (lecturers manage their own availability; officers do not have an availability workspace). These are two different concerns, and conflating them would require either a new scope/action or menu items that don't match any permission — both worse than a simple optional audience filter.
  - Alternative rejected: modifying the permission matrix to express "can read but should not appear in the menu" — would require a new scope or a non-permission flag on the action, overcomplicating the matrix for a navigation concern. The `audienceRoles` field is navigation-only; it never grants or denies anything — server guards remain the sole enforcement point.

- **Decision (c): No warning when a lecturer marks an entire weekday unavailable.** A lecturer can record e.g. MON 08:00–17:00, making them unschedulable that day. The form does not warn or block this.
  - Reason: the availability form records facts ("when am I unavailable"), not scheduling consequences. Warning about full-day unavailability conflates data entry with the generator's job. The M4 generator naturally avoids unavailable slots and reports `unplaced[]` with reasons if a lecturer has no free day for an activity. The M3 validator catches `LECTURER_UNAVAILABLE` conflicts in draft entries. Whether the university wants to restrict or warn about full-day unavailability is a policy question for the meeting (ASSUMPTION-10 covers load limits), not a prototype default.
  - Alternative rejected: a client-side check comparing the entered period against the policy slot window (08:00–17:00 per ASSUMPTION-9) — premature; the demo should show the unavailability → validator → generator pipeline working, not add UX guardrails the stakeholders have not asked for.

## 2026-11-04 Conflict validator policy, context, and scope (M3-T1)
- **Decision (a): `PolicyConfig` is passed as a parameter, not read from globals.** The validator and generator receive a `PolicyConfig` object so they remain pure — no module-level state, no `Date.now()`. `DEFAULT_POLICY` in `src/domain/policy.ts` holds the §7 assumptions (Mon–Fri, 08:00–17:00, lunch 13:00–14:00, max 6 hours/lecturer/day, max 5 classes/group/day) and is the single place to change them after the meeting.
  - Reason: matches the project's pure-function convention (AGENTS.md §3); the caller decides which policy to use.
  - Alternative rejected: importing DEFAULT_POLICY directly inside the validator — would hide the dependency and make it harder to test with alternative policies.

- **Decision (b): `ValidationContext` uses pre-resolved lookups (Record keyed by ID).** The caller resolves teachings (lecturerId, groupId, expectedSize, venueTypeRequired, unitCode), venues (capacity, type, code), lecturer unavailable periods, and venue unavailable periods before calling the validator. The validator does no DB queries, no joins, no async.
  - Reason: keeps the validator pure and synchronous; the M3-T2 draft editor (server layer) will build the context from Prisma queries, and the generator (M4) will build it from its own input. Both call the same pure function.
  - Alternative rejected: passing raw timetable entries and letting the validator resolve teaching/venue internally — would require a DB or a lookup callback, breaking purity.

- **Decision (c): Reuse `timesOverlap` and `findUnavailableConflict` from lecturerAvailability.ts.** The validator imports both so the half-open `[start, end)` range semantics are shared across overlap checks, lunch-break detection, and lecturer-unavailable matching. No duplicate overlap logic.
  - Reason: `timesOverlap` already handles malformed and reversed ranges (returns false), and `findUnavailableConflict` already ignores entries on the wrong day or with bad times — the validator gets correct behaviour without reimplementing it.
  - Alternative rejected: a local overlap helper — would risk semantic drift between the availability rules and the validator.

- **Decision (d): OUT_OF_SLOT checks in order: day validity → time format → start-before-end → slot window → lunch overlap.** The first failing check returns its violation, so the message names the most fundamental problem (a Saturday entry gets "not a teaching day", not a confusing time-window message).
  - Reason: a single OUT_OF_SLOT per entry is enough; the order surfaces the root cause.
  - Alternative rejected: reporting all slot problems at once — would produce confusing stacked messages for a single conceptual error.

- **Decision (e): Load limits (maxHoursPerLecturerPerDay, maxClassesPerGroupPerDay) are not checked.** The PolicyConfig carries them but the validator does not produce violations for them. They are soft constraints scored by the M4 generator, not hard violations. PROTOTYPE_SPEC §7 lists hard and soft constraints separately; load limits appear under "Policy config" but not under "Hard constraints" or "Soft constraints (score only)."
  - Reason: the spec's 8 violation types do not include a load-limit type; adding one would be scope creep beyond M3-T1.
  - Alternative rejected: adding a LECTURER_OVERLOAD or GROUP_OVERLOAD violation type — not in the spec's M3-T1 list.

- **Decision (f): Facility matching is not checked.** The domain model has `Unit.venueTypeRequired` (HALL | ROOM | LAB) but no per-unit required-facilities field. `Venue.facilities` exists but no unit declares what facilities it needs. ASSUMPTION-18 ("computer-based units need a lab for one session per week") is already captured by `venueTypeRequired = "LAB"` on SOEN 400, SOEN 407, and SOEN 421.
  - Reason: VENUE_TYPE checks the venue type match, which is the only facility-related constraint the model can express. Adding facility matching would require a new field on Unit, which is a model change outside M3-T1.
  - Alternative rejected: hard-coding that LAB venues must have "computers" in facilities — redundant with the type check and not generalisable.

- **Decision (g): Missing context data skips dependent checks, never crashes.** *(Superseded by M3-T1a below — the skipping behaviour is kept, but it now also returns an explicit "incomplete" outcome.)* If `context.teachings[entry.teachingId]` or `context.venues[entry.venueId]` is undefined, the validator skips CAPACITY, VENUE_TYPE, LECTURER_UNAVAILABLE, and VENUE_UNAVAILABLE for that entry. OUT_OF_SLOT still runs (it needs no context). Pairwise overlap checks still run for venue/lecturer/group resolution where both entries' teachings are found.
  - Reason: the validator is pure and must not throw on unexpected input; the caller is responsible for building a complete context. Skipping is safer than crashing, and the M3-T2 server layer will always provide a complete context.
  - Alternative rejected: emitting a "MISSING_DATA" violation — would conflate data-integrity issues with timetabling constraint violations.

## 2026-11-05 Validator result contract: incomplete context is a failure, not a clean pass (M3-T1a)
- **Decision (a): `validateEntries()` returns a discriminated `ValidationOutcome` instead of `Violation[]`.**
  `{ status: "ok"; violations }` or `{ status: "incomplete"; violations; missingContext }`. The caller must switch on `status`; an empty `violations` array only means "conflict-free" when `status === "ok"`.
  - Reason: under M3-T1 an entry whose teaching or venue was absent from the context produced zero violations, so a caller could read a broken context as a valid timetable — the exact misleading-clean-result the demo must not show. The union makes that reading a type error, not just a mistake.
  - Alternative rejected: throwing on missing context — the validator must stay pure and total (AGENTS.md §3) and the M3-T2 editor needs to display every problem in a draft, not abort at the first one.
- **Decision (b): Missing context is reported as `MissingContextError[]`, a channel kept separate from `Violation`.** Each error carries `kind` (`MISSING_TEACHING` | `MISSING_VENUE`), `entryIndex`, `entryId`, `refId` and a plain-language message. The eight scheduling violation types and their behaviour for complete inputs are unchanged.
  - Reason: a data-integrity failure is not a timetabling constraint breach; putting it in the violation union would let it be counted, filtered and rendered as if the lecturer or room were actually double-booked. This is the concern that M3-T1's rejected "MISSING_DATA violation" alternative was protecting, now expressed in its own channel.
  - Alternative rejected: a ninth `ViolationType` (e.g. `MISSING_CONTEXT`) — conflates the two categories, and a caller filtering by the spec's eight types would silently drop it.
- **Decision (c): `entryIndex` (position in the entries array) is reported alongside `entryId`.** `ValidationOutcome.missingContext` is ordered by entry index, then teaching before venue for one entry.
  - Reason: the M3-T2 editor highlights rows by position; an entry id alone forces another lookup. Index plus id also disambiguates if a draft ever repeats an id.
- **Decision (d): An empty `entries` array returns `{ status: "ok", violations: [] }` even against an empty context.**
  - Reason: nothing was left unchecked, so the validation genuinely completed. "Incomplete" means "a check could not run for an entry", not "the context happened to be small".
- **Decision (e): Existing per-entry skip behaviour is retained inside the incomplete path.** Dependent checks are still skipped (never crash), OUT_OF_SLOT and context-free pairwise venue overlap still run, and `violations` is returned so the officer sees what *was* detectable.
  - Reason: the M4 generator acceptance ("zero hard violations validated by M3-T1") needs `status === "ok"` with no violations, so a generator output with a hole in its context cannot be mistaken for a clean draft.
- **Decision (f): Context lookups use own keys only (`Object.hasOwn`) via a small `resolve()` helper.** A `teachingId`/`venueId`/`lecturerId` of `"__proto__"` can no longer resolve through the `Object` prototype and be counted as complete context; it is reported as missing. The same guard applies to the `lecturerUnavailable` / `venueUnavailable` period lookups.
  - Reason: the whole point of the new contract is that unresolvable references cannot masquerade as validated data; a prototype-chain hit is exactly that, and it would also feed a non-array into the period loops. Matches the existing precedent in `src/domain/roles.ts` and `src/domain/venueFilterParams.ts`.
  - Alternative rejected: `Object.create(null)` contexts at the call site — pushes the invariant onto every future caller instead of enforcing it where the lookup happens.
- **Files touched by this contract change:** `src/domain/validator.ts` and `src/domain/__tests__/validator.test.ts` only — `validateEntries` has no runtime caller yet (M3-T2 will be the first consumer), so no other module needed adaptation.

## 2026-11-05 Validator slot check extracted to slotValidation.ts (M3-T1b)
- **Decision**: Extracted `checkSlot()` from `validator.ts` into `src/domain/slotValidation.ts` to bring `validator.ts` under the repository's file-size guideline (322 → 268 lines). `slotValidation.ts` imports `EntryInput` and `Violation` from `validator.ts` using `import type` — these are erased at compile time, so no runtime circular dependency exists. `validator.ts` imports `checkSlot` as a runtime value; the dependency graph runs one-way at runtime (validator → slotValidation). The `TIME_HHMM_REGEX` and `isStartBeforeEnd` imports from `./types` moved to `slotValidation.ts` and were removed from `validator.ts` (they were only used by `checkSlot`). All types, `validateEntries()`, the eight violation types, `ValidationOutcome`, `MissingContextError`, the own-key `resolve()` helper, violation ordering, messages, and half-open time-interval behavior are unchanged. All 28 validator tests pass without modification.
  - Reason: the file-size guideline applies to non-exempt source files; `validator.ts` was 322 lines. Splitting by responsibility (slot-grid check vs. overall orchestration) keeps both modules cohesive and under the target.
  - Alternative rejected: a shared types module — unnecessary because `import type` creates no runtime cycle and the types already live in `validator.ts` where the test file imports them.

## 2026-11-05 Server-side draft validation loader (M3-T2a)
- **Decision (a): `EDIT_DRAFT` is decided before the first store call**, using `decideAccess(actor, "EDIT_DRAFT")` — no resource, because the action is ALL-scoped for the officer and NONE for every other role. A denied or absent caller returns `FORBIDDEN` / `UNAUTHENTICATED` and the regression tests count every fake-store method call at zero.
  - Reason: restricted timetable data (units, venues, lecturers, entries) must never be read by a caller who could not be shown it; checking after the lookup would turn a refusal into an existence oracle.
  - Alternative rejected: `requireAction` in the service — that redirects, which belongs to the page layer (M3-T2b), not to a service that must return a typed result.
- **Decision (b): refusals are typed codes, never partial data.** The result is `{ ok: true, version, entries, validation }` or `{ ok: false, kind }` with `kind` in `UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | NOT_DRAFT | INTERNAL_ERROR`. Failure branches carry no `entries`/`validation` keys (asserted by test).
  - Reason: the future officer page can render a distinct message per cause without parsing text, and cannot accidentally read an empty list as "loaded".
- **Decision (c): a version whose stored status is not DRAFT is refused as `NOT_DRAFT` (with the status echoed back) before its entries are read.** PUBLISHED and ARCHIVED are real versions, just not editable drafts; creating/moving/publishing is out of this task.
- **Decision (d): the row contract and the Prisma adapter are separate files** — `src/server/draftValidation.ts` declares `DraftValidationStore` plus the row types, `src/server/draftStorePrisma.ts` implements it with `findMany`/`select` only. Mirrors the existing `venueWrite.ts` + `venueStorePrisma.ts` and `submissionWrite.ts` + `submissionStorePrisma.ts` split, and keeps the orchestration unit-testable with a fake store.
- **Decision (e): entries are re-filtered to the requested version id even though the store query is already scoped by it.** A broken `WHERE` in a future adapter revision then yields an empty draft instead of another version's rows; the test injects a deliberately leaky store to prove it.
- **Decision (f): the loader re-orders entries into policy day order (day, then start, then id) before validating.** `ValidationOutcome.entryIndex` and the editor highlight rows by position, so the order must be the week the officer reads, not SQLite's alphabetical `day` sort (which would put FRI first). A day the policy does not list sorts last and is still reported `OUT_OF_SLOT` by the validator.
- **Decision (g): a store failure is `INTERNAL_ERROR`, never an empty list.** Every query runs inside the same try/catch, so a failed availability read cannot degrade into "this lecturer has no unavailable periods" and produce a clean-looking draft. A corrupt `TimetableVersion.status` throws in the adapter (`TimetableVersionStatusSchema.parse`) rather than being guessed as DRAFT or reported as a legitimate non-draft. Venue and unit `type` strings are passed through unvalidated — comparing them is the validator's rule, not a status enum.
- **Decision (h): the entry DTO carries the `unitCode` / `venueCode` resolved from the database, or null when the reference is unresolvable.** Unresolved rows stay in the list (the validator names them in `missingContext`) instead of vanishing, so a draft cannot look shorter or cleaner than it is. `locked` is carried through for M4-T2, which must never move a locked entry.
- **Decision (i): the lecturer-period rows are converted with `unavailablePeriodsFromRecords()`** so the loader and the availability form share one interpretation: `available: true`, unknown day, malformed or non-positive ranges are dropped, never silently treated as a restriction.
- **Decision (j): `draftValidation.ts` is 376 lines, left unsplit.** AGENTS.md allows "up to about 400 if the file is cohesive" and the five-file task cap (service + adapter + tests + PROGRESS + DECISIONS) leaves no slot for a sixth file. If M3-T2b grows the module, split the store contract into `draftValidationStore.ts` first.
  - Alternative rejected: merging the adapter into the service to save a file — would make the tested module import Prisma and exceed 500 lines.
- **Verification note**: beyond the fake-store suite, the Prisma adapter was run once against the local seeded SQLite database (temporary script, deleted afterwards): officer load of `ver-s1-planted` returned 10 entries, `status: "ok"`, and the two planted conflicts; a student returned FORBIDDEN and an unknown id NOT_FOUND; the availability queries returned the seeded `available: false` rows only. This does not replace database-backed tests, which the prototype still has none of.

## 2026-11-05 Server-side move operation for a draft entry (M3-T2b1)
- **Decision (a): EDIT_DRAFT is decided before the first store call**, the same guard the M3-T2a loader uses. `decideAccess(actor, "EDIT_DRAFT")` is ALL-scoped for the officer and NONE for every other role; a denied or absent caller returns `FORBIDDEN` / `UNAUTHENTICATED` and the regression tests assert zero store calls.
  - Reason: restricted timetable data (versions, entries, venues) must never be read by a caller who could not be shown it.
- **Decision (b): Untrusted input is validated with the existing domain Zod schemas (`DaySchema`, `TimeHHMMSchema`, `isStartBeforeEnd`) before any record is read.** The schema also requires non-empty trimmed `versionId`, `entryId` and `venueId`. A malformed request from an authorised officer triggers zero store calls.
  - Reason: reuses the established input-validation convention; no new validation primitives.
- **Decision (c): Only `day`, `start`, `end` and `venueId` are writable.** The `MoveFields` type that `moveEntry` accepts carries exactly those four fields. `teachingId`, `versionId` and `locked` are never taken from the request — the service reads the stored entry for the audit reason and the store's compare-and-set anchors the row by `id + versionId + locked=false`. A caller cannot reassign the teaching assignment, move the entry to another version, or unlock it through this operation.
  - Reason: the move is a scheduling change, not an ownership or state change; the protected fields are established by the M3-T2a loader and M4-T2 (locked entries).
- **Decision (d): The compare-and-set runs inside a Prisma `$transaction`.** `moveEntry` re-reads the version (`TimetableVersionStatusSchema.safeParse`) and rejects if it is gone or not DRAFT, then `updateMany` scoped by `id + versionId + locked=false`. If zero rows match the entry was locked, moved, or deleted during the operation → `{ stale: true }`. The audit row is written only after the update succeeds, so a stale move writes nothing.
  - Reason: a version published or an entry locked while the operation is in progress must not be modified; the transactional compare-and-set is the final safety net behind the pre-checks (which exist for clear error messages).
  - Alternative rejected: relying on the pre-checks alone (findVersion/findEntry before the write) — a race between the check and the write would silently succeed against a now-published version or now-locked entry.
- **Decision (e): The move result never claims conflict-free.** `ok: true` reports only that the entry was moved; it carries no validation outcome. Conflicts are exposed through the M3 validator, which the caller re-runs via the existing M3-T2a `loadDraftForValidation` loader. The test moves an entry into a deliberate venue clash and confirms that subsequent validation reports the correct `VENUE_OVERLAP`.
  - Reason: requirement #9 — a conflicting move may remain in a DRAFT, but it must not be reported as conflict-free. Keeping validation out of the move result avoids the race where a re-load after the write could fail, and matches the "subsequent validation" phrasing in the required tests.
- **Decision (f): The move store shares the Prisma read adapter.** `draftStorePrisma.ts` now builds one object via `buildDraftStore(): DraftValidationStore & DraftMoveStore` and exports both `createDraftValidationStore()` (unchanged return type) and `createDraftMoveStore()`. `findVersion` is shared; the new `findEntry`, `findVenueById` and `moveEntry` are added to the same object. This avoids duplicating the `findVersion` query and keeps the two contracts' row shapes from drifting.
  - Alternative rejected: a separate `draftMoveStorePrisma.ts` — would duplicate `findVersion` and the `entrySelect` constant, and add a sixth file beyond the task limit.

## 2026-11-05 Prevent stale draft moves from overwriting newer changes (M3-T2b1a)
- **Decision (a): the optimistic-concurrency token is the expected previous schedule itself** — the request carries `expectedDay`, `expectedStart`, `expectedEnd`, `expectedVenueId` (what the editor displays), and the store compares those against the stored row. No new column.
  - Reason: migrations are out of scope for this task; the four displayed fields fully describe the state the officer loaded, so matching them is a zero-schema-change compare-and-set.
  - Alternative rejected: an entry `revision`/`updatedAt` column — needs a migration and a UI contract change for no extra safety here.
- **Decision (b): two-layer check, one outcome.** The service pre-checks the expected schedule against the row read by `findEntry` and returns `STALE` before resolving the venue or writing (clear refusal, wasted nothing); the transaction's conditional `updateMany` re-matches `id + versionId + locked=false + expected day/start/end/venueId` as the final guard against a change between pre-check and commit. Both layers return the same `STALE` kind, and neither ever overwrites the newer value.
- **Decision (c): the expected fields are untrusted input.** They are validated with the same domain schemas as the proposed fields (`DaySchema`, `TimeHHMMSchema`, trimmed non-empty venue id) before any store call; a malformed expected value is `INVALID_INPUT`, not a silent mismatch.
  - Reason: they arrive from the browser even though they nominally echo stored data; compare-and-set over unvalidated strings would let formatting noise masquerade as a concurrency refusal.
- **Decision (d): the audit record describes the accepted transition and exists only for accepted moves.** The reason string is built from the stored (expected) values and the proposed values, and `auditLog.create` runs inside the same transaction strictly after `updateMany` reports `count > 0` — a rejected move persists neither an entry change nor an audit row.
- **Decision (e): the guarantee is stated at the strength the implementation and tests show.** A committed move can never silently overwrite a newer one: the loser gets `STALE`. The transactional DRAFT-version re-check from M3-T2b1 is retained. What is NOT demonstrated is two connections writing in the same instant — the in-transaction compare-and-set branches (locked entry, PUBLISHED version, schedule mismatch) are exercised by direct `moveEntry` calls against a real isolated SQLite database, and cross-officer sequencing by repeated submissions of the same stale request.
- **Decision (f): the fake store mirrors all four compare-and-set predicates** (version DRAFT, entry unlocked, right version, expected schedule) so orchestration tests cannot drift from the adapter, and the real-Prisma suite creates a fresh SQLite file in the OS temp directory (`prisma db push --skip-generate` with an injected `DATABASE_URL`), deletes only that file in `afterAll`, and never opens `prisma/dev.db`.

## 2026-11-05 Officer draft-move server action (M3-T2c1)
- **Decision (a): the action is a thin boundary — same-origin → session → shape validation → `performDraftMove`.** It adds no role check, no schedule validation and no concurrency logic of its own; every refusal the service can produce (`STALE`, `ENTRY_LOCKED`, `NOT_DRAFT`, `FORBIDDEN`, `UNAUTHENTICATED`, `INVALID_INPUT`, `VERSION_NOT_FOUND`, `ENTRY_NOT_FOUND`, `VENUE_NOT_FOUND`, `INTERNAL_ERROR`) is returned unchanged as the service's `DraftMoveResult`.
  - Reason: the accepted authorization matrix, Zod rules and two-layer compare-and-set from M3-T2b1/b1a are authoritative; duplicating them at the boundary would let the two drift.
- **Decision (b): the boundary schema is `.strict()` and string-typed only.** Exactly the ten request keys (`versionId`, `entryId`, `day`, `start`, `end`, `venueId`, `expectedDay`, `expectedStart`, `expectedEnd`, `expectedVenueId`) are accepted; any unknown key — `role`, `userId`, `actorId`, `locked`, `status`, `teachingId` — makes the whole call `INVALID_INPUT` before a store is created, and non-string values are rejected at the same point. Semantic validation (day set, HH:MM, start-before-end, trimmed non-empty ids) stays in the service.
  - Reason: rejecting forged keys outright is stronger evidence than silently ignoring them, and keeps the action's schema free of duplicated domain rules.
  - Alternative rejected: `z.object({...}).strip()` (the Zod default) — a payload with `role: "OFFICER"` would then succeed quietly, which is correct but hides tampering attempts instead of refusing them.
- **Decision (c): enforcement order matches `src/app/submissions/actions.ts`.** The same-origin check runs before `getCurrentUser()`; a missing session returns `UNAUTHENTICATED` and an input-shape failure returns `INVALID_INPUT`, both before `createDraftMoveStore()` is ever called — tests assert the factory itself is not invoked on those paths.
- **Decision (d): unexpected failures never leak internals and never reach the browser as text.** `performDraftMove` already converts store failures to `INTERNAL_ERROR` (log: message only); the action adds its own try/catch around the service call and the store factory for anything else, logging `error.message` only and returning the same typed `INTERNAL_ERROR`. A success is `{ ok: true, entryId, versionId }` — the action cannot and does not report the draft conflict-free; the editor (M3-T2b2) must reload through `loadDraftForValidation()` (requirement #9, asserted by a test that the result keys and JSON carry no validation/conflict vocabulary).

## 2026-11-05 Officer draft editor page (M3-T2b2)
- **Decision (a): six files for this task, approved by the user before implementation** — the AGENTS.md 5-file cap was raised explicitly after the page, move form, menu flip, menu test, PROGRESS.md and DECISIONS.md were counted.
- **Decision (b): the draft is selected by `?version=` with a server-rendered GET picker listing stored DRAFT versions.** The list query (`prisma.timetableVersion.findMany({where:{status:"DRAFT"}})`) is a thin guarded read inlined in the page — no new server-loader file, to keep within the approved six-file scope; only an exact match against a stored DRAFT id is used, an unknown/blank selection falls back to the first draft with a fixed notice.
  - Reason: the browser `version` param is untrusted; `loadDraftForValidation` re-decides EDIT_DRAFT, re-checks DRAFT status and scopes every read to the chosen id, so a forged id reads nothing it should not.
- **Decision (c): the optimistic-concurrency token shown to the officer is always the latest server render.** Local state holds only the officer's proposed day/start/end/venue; the `expected*` values sent to `moveDraftEntryAction` come from page props. After a success or a `STALE` refusal the client calls `router.refresh()`, re-running `loadDraftForValidation()` — the conflict summary and inline messages the officer reads are fresh server validation, never the move result (requirement #9). A stale attempt from an old page shows the STALE message and the true current schedule.
- **Decision (d): refusal kinds are rendered from a fixed message table in the client**; only `INVALID_INPUT` echoes a server string, and that string is generated from `performDraftMove`'s fixed messages. Loader refusals render fixed page copy per typed kind, never stored text.
- **Decision (e): locked entries render a "Locked" badge and no form** (the move service refuses them anyway); unresolved unit/venue references render "(unit unresolved)"/"(unknown venue)" and the amber incomplete-validation notice from M3-T1a is shown above the table, so a draft can never look cleaner than it is.
- **Decision (f): pairwise violations are shown on the earlier entry of the pair only** — the validator reports each conflict once and its message names both classes ("CR1 is used by two classes at the same time (MON 08:00-09:00)"), which is the spec's "exact reason" without duplicating the violation.
- **Alternative rejected (c): client-side pre-fill of expected values from form state** — would send the officer's in-flight edits as the concurrency token and defeat compare-and-set.
