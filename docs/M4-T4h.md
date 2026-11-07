# M4 T4h timetable access amendment

The published timetable enforces the authenticated user's responsibilities on the server. Implementation and automated verification are complete. M4-T4 is ACCEPTED AND CLOSED for the approved prototype scope after user-reported manual browser acceptance: 24/24 original workflow checks before the security amendment and 8/8 subsequent security checks. The user performed and reported these browser checks; this coding agent did not perform them. M5 is NOT STARTED.

## Access contract

| Role | Group view | Lecturer view | Venue view |
| --- | --- | --- | --- |
| Student | Assigned group only | Denied | Denied |
| Lecturer | Groups taught in the selected semester; own sessions only | Own linked lecturer identity only | Denied |
| Department representative | Groups in own stored department | Relevant lecturers; only sessions for own department groups | Denied |
| Approver | Groups in own stored department | Relevant lecturers; only sessions for own department groups | Denied |
| Officer | All | All | All |
| Admin | All, explicitly retained read-only scheduling oversight | All, explicitly retained read-only scheduling oversight | All, explicitly retained read-only scheduling oversight |

Students still see the venues and teaching staff attached to their own classes. Lecturers still see venues and groups attached to their own teaching. No general occupancy feature was added. Department relevance follows the student group's department, including teaching by staff whose home department differs. In a lecturer group view, colleagues' sessions are intentionally excluded.

The permission matrix uses OWN_GROUP, OWN_CLASSES and OWN_DEPARTMENT for the restricted roles. Page entry uses requireAnyAction; it does not grant access to a record. The published read service independently resolves the allowed selection and filters every returned entry using stored relationships. Only semester, view and id are accepted as request fields. Missing identity links do not permit selection of another user's timetable. Unauthorized selections return the typed FORBIDDEN result, rendered as a Not permitted panel; this server-rendered page does not claim an HTTP 403 response. Existing login redirects and page guards remain.

## Implementation and verification

Five separate commits cover the contract, service enforcement, page controls, real SQLite security tests, and final copy/documentation. No dependency, schema, migration or seed-data change was made. The original specification was not rewritten; this document and DECISIONS.md record the user-approved policy amendment.

- Recorded M4-T4h verification: typecheck and lint pass; 1353 tests pass in 56 files; seed integrity 11/11.
- M4-T4i closure rerun on 2026-11-08: RUST_LOG=info npm run verify exited 0 with typecheck and lint pass, 1353/1353 tests in 56 files (62.12s), and seed integrity 11/11 (1.78s). RUST_LOG=info npm run build exited 0; Next.js 15.5.28 compiled in 8.9s and generated 19/19 pages. No executable code changed.
- Baseline: 1303 tests in 54 files. Fifty regressions were added: eight pure policy, twelve service, ten page, eighteen real SQLite and two publication navigation tests.
- The existing real publication lifecycle suite still checks publish/archive transitions, current-version resolution, entry preservation, semester isolation, stale detection and write-free reads. Old globally visible selection assertions now use the officer role; restricted-role denials are asserted explicitly.
- A new SQLite fixture includes two departments, three groups, two lecturers, cross-department service teaching, both semesters, published versions, a draft and an archive. It verifies selectors and per-entry boundaries using actual stored relationships.
- Production build passes with Next.js 15.5.28. npm run dev reached Ready on port 3100 and was stopped before the build.
- The earlier M4-T4h verify and build transcript remains unchanged in M4-T4h-verification.txt; terminal trailing whitespace is normalized. Its /workspace/scratch path identifies that prior execution environment, not the Windows closure rerun.

The inherited workspace RUST_LOG value caused Prisma's schema engine to exit during fixture initialization without an explanation. A controlled probe with the same command and fresh databases isolated that environment issue; RUST_LOG=info resolves it. Final commands used RUST_LOG=info npm run verify and RUST_LOG=info npm run build. No workaround was committed to application code. The initial fixture seeding attempt through the tsx CLI encountered a blocked IPC socket; node --import tsx prisma/seed.ts seeded the disposable fixture successfully without changing the project.

## Browser acceptance record

### Original workflow acceptance: user-reported 24/24 PASS

The user personally performed the original browser checks before the security amendment and reported all 24 as passed. User observations: none recorded. The supplied review groups related assertions rather than numbering every check separately; the recorded total remains the user's reported 24/24, with no additional observations invented.

Login and navigation:
- Signed-out timetable access redirected to login.
- Officer could navigate from the homepage.
- Student and lecturer roles accessed the timetable.
- Unfinished features remained Coming soon.

Published timetable:
- Correct semester and published version displayed.
- Student's assigned group selected by default.
- Lecturer's sessions selected by default.
- Group, lecturer and venue selectors worked under the original permissions.
- Semester switching selected the correct publication.

Publication workflow:
- Draft validation and confirmation worked.
- Cancel did not publish.
- Confirm published the intended version.
- Published timetable updated.
- Previous version was archived and excluded from the current view.

Visual and accessibility:
- Desktop 1440×900 readable.
- Desktop hour rows aligned across day columns.
- Mobile 390×844 usable.
- Mobile 375×667 usable.
- Multi-hour sessions displayed correctly.
- Overlapping sessions remained visible.
- Browser zoom at 200% usable.
- Keyboard navigation worked.

This pre-amendment acceptance does not prove the revised authorization rules. No grid geometry change was made by the amendment.

### Security amendment acceptance: user-reported 8/8 PASS

The user subsequently performed and reported all eight requested browser security checks:
1. Student opens their own timetable successfully.
2. Student manually requests another group's ID and receives Not permitted.
3. Student manually requests lecturer and venue perspectives and receives Not permitted.
4. Lecturer sees only their own sessions.
5. Lecturer manually requests another lecturer's timetable and receives Not permitted.
6. Department representative and approver see only their department's relevant sessions.
7. Officer retains all three group, lecturer and venue perspectives.
8. Publishing a valid draft allows navigation through the updated success link.

These are user-reported manual observations, not browser tests executed by this coding agent. They are not a formal penetration test, production security audit or real university deployment. No blocking browser defect was reported by the user.

### Requested coverage and evidence boundary

During the earlier M4-T4h execution, the browser service could not open the local app and then explicitly blocked local URL access by policy; no workaround was attempted after that denial. That historical tooling incident is superseded for acceptance by the user's subsequent manual report, not by an agent browser run. Static React rendering and real database tests remain separate automated evidence. The original handoff checklist is retained below with its evidence boundary made explicit; a row not covered by the eight reported security checks is not promoted to a live pass.

| Check | Expected result | Current evidence |
| --- | --- | --- |
| Sign out and open /timetable | Redirect to login | User-reported pre-amendment pass; guard/page tests; no separate amended retest reported |
| Sign in as a student and open Timetable from home | Own group, semester selector only | User security check 1 confirms own timetable; selector restriction covered by page/service/SQLite tests |
| Student requests view=group with another existing group id | Not permitted; no session entries | User security check 2; no-entry boundary covered by page/service/SQLite tests |
| Student requests lecturer or venue view with a known id | Not permitted; no unrelated options or entries | User security check 3; option/entry boundaries covered by tests |
| Lecturer opens own timetable | Own teaching sessions only | User security check 4; page/service/SQLite tests |
| Lecturer chooses a taught group | Only own teaching in that group | Own-session restriction reported in check 4; taught-group filtering covered by tests |
| Lecturer requests another lecturer, untaught group or venue view | Not permitted; no entries | User security check 5 covers another lecturer; untaught-group/venue denials covered by tests |
| Department rep and approver choose relevant external lecturer | Own department group sessions only | User security check 6 confirms department-relevant sessions; external service teaching covered by SQLite tests |
| Department user requests another department group or venue | Not permitted; no entries | Department-only visibility reported in check 6; explicit forged denials covered by service/SQLite tests |
| Switch semester as lecturer | Taught-group choices follow that semester | Real SQLite test; no separate user browser result reported |
| Missing student, lecturer or department link | Recovery guidance; no alternate identity fallback | Page/service/SQLite tests; no separate user browser result reported |
| Officer views group, lecturer and venue schedules | Full existing functionality | User security check 7; existing/new suites |
| Publish a valid draft and follow success link | Correct semester's current published timetable | User security check 8; lifecycle and rendered-link tests |
| Desktop/mobile widths, keyboard and increased zoom | Readable controls and unchanged timetable layout | User-reported pre-amendment 24/24; no amended layout retest reported |

For any future repetition, use real account sign-in or the existing demo switcher and stored synthetic IDs; do not fabricate authentication cookies. A refusal must show no data-entry-id timetable entries, and hiding a selector alone is not a pass. Existing production seed guards apply. Do not run seed or db push against a database you need to preserve.

## Scope and limitations

During the earlier M4-T4h execution in a fresh clone, protected prisma/dev.db and prisma/walkthrough.db were absent. Neither was created, opened, migrated, seeded, copied or overwritten by that execution. All test databases used exclusive temporary directories. The browser fixture used its own temporary database; no browser interaction reached it. The application server was stopped. Cleanup removed only that task's browser/probe directories and the integration suites' own exclusive directories; no tracked repository file was deleted. In the M4-T4i closure workspace both protected files are present; their raw-byte before/after SHA-256 preservation results are recorded in PROGRESS.md. The closure task did not open either through Prisma or SQLite and did not seed, migrate, reset, copy, overwrite, rename or delete them.

Access metadata and the published entry transaction are separate reads; the existing coherent publication snapshot is preserved, but this amendment does not claim atomic protection against simultaneous changes to user/group/teaching ownership during a request. No load or simultaneous-writer race result is claimed.

Academic teaching-data entry and management, an explicit approved-departmental-submission prerequisite where required, venue occupancy/status views with appropriate data minimization, and other currently unfinished Coming soon features remain later work. The university's actual timetabling procedures and rules still require validation with the timetabling department, and additional security, concurrency and deployment verification is required before operational use. Report language must continue to distinguish the implemented SQLite responsive web prototype from the report's planned broader system. No claim of operational university deployment, formal penetration test or production security audit is made; browser acceptance is limited to the user-reported prototype checks recorded above.

## Publication status

Current status, independently verified with Git on 2026-11-08 before M4-T4i edits: local m4-generator-versions, origin/m4-generator-versions and the live GitHub branch all resolved to 2b55143cb01546cd20621dfa267aba9bb912f39b; the working tree was clean and ahead/behind was 0/0. All five M4-T4h commits are present on the remote branch:
- 5258c58377fc9eb50805546b429eed45a4a4c790 — M4-T4h1 security contract.
- 482ac2b29c13d8d048d6a9c9aa9581233f8c7e31 — M4-T4h2 server enforcement.
- c934d91801f73da03f7b64c06f3fd8605c325032 — M4-T4h3 controls and permission scopes.
- 1846e9d0fa5ca4aefc5a65e72f75b51a095fc52c — M4-T4h4 real multi-department SQLite boundaries.
- 2b55143cb01546cd20621dfa267aba9bb912f39b — M4-T4h5 publication guidance and verification handoff.

M4-T4i adds one documentation-only closure commit after this verified baseline; its exact created SHA is reported after commit/push rather than guessed in advance. Live master remained at 436d4836d0a073cbb6e23c70e804ebf2505a2980 and did not contain the M4-T4h head; this task performs no master merge and creates no M5 branch.

Historical incident: the earlier GitHub integration rejected creation of the commit tree with HTTP 403 Resource not accessible by integration, and direct Git push then failed because no write credential was available. At that time the remote remained at 2b0e28fcfa0bfc5789bc7d5511b4bb15c5e5c13a and the five-commit patch was the handoff. That failure is preserved as history only; the verified pushed state above supersedes it.

## Pull into local VS Code

With a clean working tree, switch to m4-generator-versions and run git pull --ff-only origin m4-generator-versions. If Git reports divergence or local changes, keep those changes and reconcile them before pulling; do not reset or force-push. Run npm ci if dependencies are not installed, then npm run verify. This amendment does not require a database migration or reseeding.
