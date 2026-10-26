# DECISIONS.md
(Record every technical decision: date · decision · reason · alternative rejected.)

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

## 2026-10-26 Linter Tooling (M0-T2)
- **Decision**: next lint is deprecated in Next.js 16; staying on ESLint via next lint for the prototype.
- **Reason**: Standard Next.js lint runner works cleanly with current config and avoids introducing unnecessary codemod overhead or additional scripts during prototype phase.
- **Alternative rejected**: Migrating to standalone ESLint CLI command at this time.

## 2026-10-26 Baseline Stack Initialization (M0-T1)
- **Decision**: Configured Next.js App Router with TypeScript strict mode, Vitest unit test runner with `@/*` alias, Tailwind CSS, ESLint, and Prisma with SQLite (`dev.db`).
- **Reason**: Matches the prototype stack specification §4 and repository layout §5. Fast to run locally without Docker for prototype demos.
- **Alternative rejected**: PostgreSQL with Docker Compose at this stage (rejected per spec §4 and §11 until M9-T1).
