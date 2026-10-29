# DECISIONS.md
(Record every technical decision: date · decision · reason · alternative rejected.)

## 2026-10-26 Signed-Cookie Sessions Instead of Auth.js (M1-T3a)
- **Decision**: Implemented custom signed-cookie sessions using Node built-in `crypto` (HMAC-SHA256) rather than Auth.js (next-auth).
  - Token format: `base64url(JSON payload)` + `.` + `base64url(HMAC-SHA256 signature)`.
  - Session duration: **8 hours** (SESSION_DURATION_MS = 28 800 000 ms). ASSUMPTION-3: assumed reasonable session length for university staff; to be confirmed.
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
