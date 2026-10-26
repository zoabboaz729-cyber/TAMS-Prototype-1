# PROTOTYPE_SPEC.md — TAMS meeting prototype

## 1. Goal
Show the Kisii University timetabling department a working prototype built on our **assumptions**, so they can tell us what is right, wrong, and missing. Success = they react to concrete screens and give corrections. Success is NOT feature completeness.

## 2. Principles (why the prototype is shaped this way)
1. **Always demoable.** Each milestone ends with a running app, so if the meeting date arrives early we show the last finished milestone.
2. **Timetabling core first.** The audience is the timetabling department; their pains (clashes, room visibility, rework) come before attendance.
3. **Testable logic, thin UI.** Weak coding agents fail on big tangled tasks and succeed on small pure functions with tests.
4. **Assumptions are visible.** Every assumption is labelled so the meeting can confirm or reject it.
5. **Nothing fake.** Stubs are labelled; data is synthetic and says so.

## 3. Scope
| Area | Prototype level | Reason |
|---|---|---|
| Roles and login (admin, timetabling officer, dept rep + approver, lecturer, student) | REAL | Role-based access is a core claim. |
| Department submission and approval | REAL (simple status flow) | Tests assumption that departments submit needs. |
| Room register with ownership | REAL | Tests the owned-versus-shared room assumption. |
| Conflict validator | REAL, unit-tested | Highest-value, lowest-risk logic. |
| Timetable generator | REAL (greedy + backtracking, small data) | Core promise; keep simple, no external solver. |
| Draft / published versions | REAL | Avoids silent replacement of published timetables. |
| Venue live status | REAL with **demo clock** | Lets us show "occupied / soon / free" at any time. |
| Reschedule request with conflict check | REAL (basic) | Rescheduling is the stated cause of clashes. |
| Issue reporting to timetabling desk | REAL (basic list) | Stated requirement. |
| QR attendance (lecturer opens, student scans) | REAL (web camera or typed code) | Core second pillar. |
| Device binding | STUB (stores a random device ID) | Real binding needs policy decisions from the university. |
| Reports | REAL (2 reports) | Enough to show value. |
| Assumptions page with feedback capture | REAL | Turns the demo into data collection. |
| Mobile | Responsive web app (PWA-style), no native app | One codebase; weak agent + no budget. |
| Student-portal integration, exams, events, moderators | OUT | Needs the meeting answers first. |

## 4. Stack (and why)
- **Next.js (App Router) + TypeScript (strict)**: one codebase for web and mobile browser; huge training data so free models write it better.
- **SQLite + Prisma for the prototype** (decision: no Docker needed, one-file database, fastest for demos). The final application moves to **PostgreSQL via Docker Compose** later (task M9-T1), matching the project report. To keep that switch cheap: (a) store enums as plain strings and define the allowed values as TypeScript constants + zod validators in `src/domain/types.ts`; (b) store list fields such as `facilities` as a JSON string with one helper to read/write it; (c) never use SQLite-only SQL, use Prisma queries only; (d) never commit the `.db` file.
- **Auth**: simple email + password sessions (Auth.js credentials or a small custom session). Seeded demo accounts. No external providers.
- **Validation**: `zod`. **Tests**: `vitest`. **Lint**: ESLint. **Styling**: Tailwind CSS.
- **QR**: generate with `qrcode`; scan with `html5-qrcode` (camera) plus a typed-code fallback.
- **No** external solver, no queue, no cache, no microservices.

## 5. Repository layout
```
src/domain/        pure logic: validator, generator, venueStatus, attendance rules, policy
src/domain/__tests__/
src/server/        database access, auth, route/action handlers
src/app/           pages by role: /officer /department /lecturer /student /admin /assumptions
prisma/schema.prisma, prisma/seed.ts
AGENTS.md  PROGRESS.md  PROTOTYPE_SPEC.md  DECISIONS.md
```

## 6. Domain model (minimum)
User(id, name, email, passwordHash, role, departmentId?, studentGroupId?) · Department(id, name, schoolId) · Venue(id, code, type[HALL|ROOM|LAB], capacity, ownerDepartmentId? (null = shared), facilities[], status) · VenueUnavailable(venueId, day, start, end, reason) · Lecturer(id, userId, departmentId) · LecturerAvailability(lecturerId, day, start, end, available) · StudentGroup(id, name, size, departmentId) · Unit(id, code, title, departmentId, semester, hoursPerWeek, venueTypeRequired, scheduled) · Teaching(id, unitId, lecturerId, groupId, expectedSize, sessionsPerWeek, sessionLength) · Submission(id, departmentId, semester, status[DRAFT|SUBMITTED|RETURNED|APPROVED], reviewerId, note) · TimetableVersion(id, semester, status[DRAFT|PUBLISHED|ARCHIVED], createdBy, publishedAt) · TimetableEntry(id, versionId, teachingId, venueId, day, start, end, locked) · RescheduleRequest(id, entryId, requestedBy?, proposedDay, proposedStart, proposedEnd, status, reason, decisionNote?) · Issue(id, departmentId, venueId?, reportedBy?, text, status) · AttendanceSession(id, entryId, openedBy, opensAt, closesAt, scanFrom, mode[STATIC|ROTATING], status) · AttendanceRecord(id, sessionId, studentId, recordedAt, deviceId) with UNIQUE(sessionId, studentId) · AuditLog(id, actorId, action, entity, entityId, at, reason) · AssumptionFeedback(id, assumptionKey, verdict, note, at).

## 7. Policy config (all rules configurable, none hard-coded in logic)
`src/domain/policy.ts` exports a `PolicyConfig` with defaults. **All values below are ASSUMPTIONS** to be replaced after the meeting:
- Days: Mon–Fri. Slots: hourly, 08:00–17:00. Lunch 13:00–14:00 not used. (ASSUMPTION-9)
- Max teaching hours per lecturer per day: 6. Max classes per group per day: 5. (ASSUMPTION-10)
- Capacity rule: venue capacity ≥ expected size, no overbooking. (ASSUMPTION-11)
- Semester weeks: S1 Aug–Dec, S2 Jan–Apr. (ASSUMPTION-8)
**Hard constraints:** venue overlap, lecturer overlap, group overlap, capacity, venue type/facilities, lecturer unavailable, venue unavailable, outside allowed slots.
**Soft constraints (score only):** fewer gaps for groups, fewer venue changes, preferred slots, balanced days.

## 8. Roles and permissions
| Action | Admin | Officer | Dept rep | Approver (HoD) | Lecturer | Student |
|---|---|---|---|---|---|---|
| Manage users | Y | | | | | |
| Declare own-department rooms | | Y | Y | | | |
| Manage shared rooms | | Y | | | | |
| Create/submit submission | | | Y | | | |
| Approve/return submission | | | | Y (own dept) | | |
| Generate/edit draft timetable | | Y | | | | |
| Publish timetable | | Y | | | | |
| Request reschedule | | | | | Y (own classes) | |
| Decide reschedule | | Y | | | | |
| Report issue | | | Y | Y | Y | |
| Open attendance | | | | | Y (own classes) | |
| Scan attendance | | | | | | Y (own group) |
| View published timetable / venue status | Y | Y | Y | Y | Y | Y |
| View attendance reports | | Y | Y (own dept) | Y (own dept) | Y (own classes) | own only |
Server must deny everything not marked Y.

## 9. Assumptions to label in code and on the `/assumptions` page
1 Timetables are shared via WhatsApp · 2 Each department has a timetabling rep · 3 One whole-year timetable, two semesters · 4 Departments own rooms; unclaimed rooms are shared · 5 Clashes mostly follow lecturer reschedules · 6 Attendance is on paper registers · 7 Computing runs a GPS attendance pilot · 8 Semester dates Aug–Dec, Jan–Apr · 9 Slot grid and days · 10 Load limits · 11 Capacity rule · 12 HoD approves department submissions · 13 Registrar/officer publishes · 14 Students have smartphones · 15 Each unit has 3 contact hours per week (2+1) · 16 Professional Attachment (SOEN 321) is not timetabled · 17 The pilot class is Year 4 · 18 Computer-based units need a lab for one session a week.
Each has a key `A1`…`A18`. The `/assumptions` page lists them with Confirm / Reject / Modify + note, saved to `AssumptionFeedback`.

## 10. Seed data (synthetic; labelled synthetic; replace after meeting)
- 1 school, 3 departments: Computing, Mathematics (service units), plus one department that owns no shared rooms.
- 9 venues: LH1 hall 150, LH2 hall 100, CR1 60, CR2 50, CR3 40, LAB1 40 (computer), LAB2 30 (computer), GR1 80 **shared/unowned**, GR2 40 **shared/unowned**.
- 6 lecturers (2 teach across departments), each with some unavailable periods.
- Groups: **SE-Y4** (45 students, the pilot class; year assumed from the 4xx unit codes, ASSUMPTION-17), CS-Y2 (50, 6 synthetic units), SE-Y1 (60, 6 synthetic units), plus 3 synthetic Mathematics service units shared across groups. Group sizes are synthetic.
- **Real units for the pilot class (from the student's own course list).** Contact hours are assumed 3 per week per unit, as one 2-hour and one 1-hour session (ASSUMPTION-15), venue type ROOM unless stated.
  - Semester 1: SOEN 413 Software Architecture · SOEN 415 Interactive Design & Software Project Management · SOEN 410 Software Process, Testing & Reliability · SOEN 426 Human Computer Interaction · SOEN 412 Professional Practices & Ethics · SOEN 400 Data Mining & Analytics · SOEN 321 Professional Attachment (**not scheduled**, see below).
  - Semester 2: SOEN 407 Digital Image Processing · SOEN 425 Performance Engineering of Software Systems · SOEN 421 Systems Project · SOEN 424 Systems Auditing & Quality Assurance · SOEN 490 Number Theory & Cryptography · SOEN 456 Software Metrics.
  - SOEN 321 Professional Attachment is an industrial placement, so it is marked `scheduled=false` and excluded from generation (ASSUMPTION-16). This gives 6 scheduled units per semester, matching the report. Add a `scheduled` boolean to `Unit`. Whether this is true must be asked at the meeting; the list has 13 units, so the report's "12 units" wording needs checking.
  - Computer-based units (SOEN 400, SOEN 407, SOEN 421) require venue type LAB for one session per week (ASSUMPTION-18).
  - Lecturers are synthetic names (e.g. "Lecturer A"); never real staff names.
- Seed also provides **two intentionally conflicting draft entries** (venue clash; lecturer clash) used by tests and by the demo.
- Demo accounts: one per role, password in `.env.example` only for local use.

## 11. Milestones and tasks
Run tasks in order. After each task: `npm run verify` passes, app runs, `PROGRESS.md` updated.

### Tier 1 — meeting-ready core (must exist for a credible demo)
**M0 Foundation**
- M0-T1 Create Next.js + TS strict + Tailwind + vitest + eslint + Prisma (SQLite). `npm run verify` script (typecheck, lint, test, seed check). *Accept:* fresh clone → `npm i && npx prisma migrate dev && npm run verify && npm run dev` works. No Docker files yet.
- M0-T2 Add agent files (`AGENTS.md`, `PROGRESS.md`, `DECISIONS.md`) and the prototype banner component. *Accept:* banner on every page.

**M1 Data, auth, roles**
- M1-T1 Prisma schema from §6 + migration. *Accept:* migration applies cleanly.
- M1-T2 Seed script per §10, deterministic. *Accept:* `npm run seed` twice gives same counts; seed check test asserts counts and the two planted conflicts exist.
- M1-T3 Login, sessions, role guard helper, role-based home pages with demo account switcher (switching must still call the server auth). *Accept:* each role sees only its menu; a student calling an officer route is denied (test).

**M2 Rooms and department submissions**
- M2-T1 Venue register page: list, filter, ownership shown (department / shared). Dept rep can edit own rooms; officer manages shared rooms. *Accept:* dept rep cannot edit another department's room (test).
- M2-T2 Submission workflow DRAFT→SUBMITTED→RETURNED/APPROVED with reviewer, note, audit log. *Accept:* only approver of that department can approve (test); transitions logged.
- M2-T3 Lecturer availability form. *Accept:* saved periods appear in the validator input.

**M3 Conflict validator**
- M3-T1 `validateEntries(entries, context, policy)` pure function returning a list of typed violations (VENUE_OVERLAP, LECTURER_OVERLAP, GROUP_OVERLAP, CAPACITY, VENUE_TYPE, LECTURER_UNAVAILABLE, VENUE_UNAVAILABLE, OUT_OF_SLOT). *Accept:* ≥ 2 tests per violation type plus a clean case; the two planted seed conflicts are detected.
- M3-T2 Officer "Draft editor": view draft entries, move/add an entry, show violations inline with a plain-language message. *Accept:* moving an entry into a clash shows the exact reason.

**M4 Generator and versions**
- M4-T1 `generateTimetable(input, policy)` pure function: order activities by difficulty, assign slot+venue by backtracking with a step limit; returns `{entries, unplaced[], softScore}`; never silently drops an activity. *Accept:* seed data produces a draft with zero hard violations (validated by M3-T1); an impossible input (too few rooms) returns `unplaced` with reasons; deterministic for same input.
- M4-T2 "Generate draft" action creating a DRAFT version; locked entries are kept. *Accept:* locked entry never moves (test).
- M4-T3 Publish action: DRAFT→PUBLISHED archives the previous version, blocked if hard violations exist. *Accept:* publishing a draft with violations is refused (test).
- M4-T4 Timetable views for published version: by group, lecturer, venue (week grid). *Accept:* a student sees only their group by default.

**M5 Venue status and demo clock**
- M5-T1 `venueStatus(version, venue, now, policy)` pure: OCCUPIED, UPCOMING (starts within 30 min), FREE, UNAVAILABLE, plus next free time. *Accept:* boundary tests at start, end, and 30-minute marks.
- M5-T2 Venue board page + **demo clock control** (set any day/time, or "live"). Clock is passed into pure functions, never read inside them. *Accept:* changing the clock changes statuses immediately.

### Tier 2 — completes the story
**M6 Change handling**
- M6-T1 Lecturer reschedule request; officer sees conflict check result before deciding; approved change creates a new draft version, never edits the published one. *Accept:* a request into a clash shows the reason and cannot be approved without override + reason (audit logged).
- M6-T2 Issue reporting: dept rep/lecturer submits; officer list with status. *Accept:* issue appears for officer, role rules enforced.

**M7 QR attendance**
- M7-T1 `attendanceRules` pure: token issue/validate (HMAC with expiry, no personal data), window check (scan allowed only inside `scanFrom..closesAt`), eligibility (student in group), duplicate rejection. *Accept:* tests for expired, early, wrong group, duplicate, tampered token.
- M7-T2 Lecturer opens session for own scheduled class (mode STATIC or ROTATING 30 s), sees QR and live count. *Accept:* cannot open for another lecturer's class.
- M7-T3 Student scan page: camera scan + typed code fallback; shows server-confirmed success or the exact failure reason; stores random device ID (STUB for binding). *Accept:* UI shows "confirmed" only after server success.
- M7-T4 Reports: attendance per session (lecturer) and per unit/department (approver). *Accept:* totals match seeded scans.

### Tier 3 — meeting tools
**M8 Meeting tools and polish**
- M8-T1 `/assumptions` page (§9) with Confirm/Reject/Modify + note, and an export to CSV for the findings register.
- M8-T2 Demo script page (§12) and consistent empty/error states; seed reset button for the demo. *Accept:* full demo runs end to end from a fresh seed without errors.

## 12. Demo script (10 minutes)
1. Open `/assumptions`, state "this is what we think; please correct us" (1 min).
2. Department rep submits needs; approver approves (2 min).
3. Venue register: owned versus shared rooms (1 min).
4. Officer opens the planted-clash draft: violations shown; fix one (2 min).
5. Generate a draft, publish, show views by group/lecturer/room (2 min).
6. Venue board with demo clock: change time, statuses update (1 min).
7. Lecturer opens attendance, student scans, duplicate rejected (1 min).
After each step ask: "Is this how it works? What is missing?" and write into the findings register.

## 13. Verification: what "done" means (the whole prototype)
- `npm run verify` passes from a fresh clone.
- Every Tier 1 acceptance item has evidence in `PROGRESS.md`.
- The demo script runs on a phone and a laptop without errors, from a reset seed.
- No page shows real personal data; banner everywhere.
- Every assumption A1–A18 is tagged in code and listed on `/assumptions`.
- Known gaps are listed in `PROGRESS.md` under "Known problems".

### Post-prototype (not part of the meeting build)
**M9 Production switch** — M9-T1 add Docker Compose with PostgreSQL, change Prisma provider, convert string enums and JSON lists to native types, re-run all tests. Do this only after the meeting findings are applied to the spec.

## 14. Risks
Generator too slow or unsolvable on bigger data → step limit + `unplaced` report. Weak agent loops → 3-attempt stop rule. SQLite lock errors in dev → run only one dev server at a time. Camera permission fails on demo device → typed-code fallback. No internet at the venue → run locally and keep screenshots as backup.
