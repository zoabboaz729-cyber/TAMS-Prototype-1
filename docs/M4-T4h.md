# M4 T4h timetable access amendment

The published timetable now enforces the authenticated user's responsibilities on the server. Implementation and automated verification are complete. Live browser acceptance remains pending because this execution's browser URL policy blocked the local application. M5 has not started.

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

- Final verification: typecheck and lint pass; 1353 tests pass in 56 files; seed integrity 11/11.
- Baseline: 1303 tests in 54 files. Fifty regressions were added: eight pure policy, twelve service, ten page, eighteen real SQLite and two publication navigation tests.
- The existing real publication lifecycle suite still checks publish/archive transitions, current-version resolution, entry preservation, semester isolation, stale detection and write-free reads. Old globally visible selection assertions now use the officer role; restricted-role denials are asserted explicitly.
- A new SQLite fixture includes two departments, three groups, two lecturers, cross-department service teaching, both semesters, published versions, a draft and an archive. It verifies selectors and per-entry boundaries using actual stored relationships.
- Production build passes with Next.js 15.5.28. npm run dev reached Ready on port 3100 and was stopped before the build.
- Complete final verify and build output is in M4-T4h-verification.txt; terminal trailing whitespace is normalized.

The inherited workspace RUST_LOG value caused Prisma's schema engine to exit during fixture initialization without an explanation. A controlled probe with the same command and fresh databases isolated that environment issue; RUST_LOG=info resolves it. Final commands used RUST_LOG=info npm run verify and RUST_LOG=info npm run build. No workaround was committed to application code. The initial fixture seeding attempt through the tsx CLI encountered a blocked IPC socket; node --import tsx prisma/seed.ts seeded the disposable fixture successfully without changing the project.

## Browser acceptance still required

The supplied acceptance review records the user's 24/24 manual checks for the earlier timetable workflow, including desktop/mobile layout, zoom, keyboard use and no observed D2 row-alignment defect. Those results remain valid as the recorded pre-amendment acceptance; they are not claimed as a retest of this code. No grid geometry change was made.

The browser service could not open the local app and then explicitly blocked local URL access by policy. No workaround was attempted after that denial. Static React rendering and real database tests do not establish interactive browser behavior. Perform these checks against a disposable synthetic demo database before closing M4-T4h:

| Check | Expected result | Current evidence |
| --- | --- | --- |
| Sign out and open /timetable | Redirect to login | Existing guard/page tests; live retest pending |
| Sign in as a student and open Timetable from home | Own group, semester selector only | Page/service/SQLite tests; live retest pending |
| Student requests view=group with another existing group id | Not permitted; no session entries | Page/service/SQLite tests; live retest pending |
| Student requests lecturer or venue view with a known id | Not permitted; no unrelated options or entries | Page/service/SQLite tests; live retest pending |
| Lecturer opens own timetable | Own teaching sessions only | Page/service/SQLite tests; live retest pending |
| Lecturer chooses a taught group | Only own teaching in that group | Page/service/SQLite tests; live retest pending |
| Lecturer requests another lecturer, untaught group or venue view | Not permitted; no entries | Page/service/SQLite tests; live retest pending |
| Department rep and approver choose relevant external lecturer | Own department group sessions only | Page/service/SQLite tests; live retest pending |
| Department user requests another department group or venue | Not permitted; no entries | Service/SQLite tests; live retest pending |
| Switch semester as lecturer | Taught-group choices follow that semester | Real SQLite test; live retest pending |
| Missing student, lecturer or department link | Recovery guidance; no alternate identity fallback | Page/service/SQLite tests; live retest pending |
| Officer views group, lecturer and venue schedules | Full existing functionality | Existing/new suites; live retest pending |
| Publish a valid draft and follow success link | Correct semester's current published timetable | Lifecycle and rendered-link tests; live retest pending |
| Desktop/mobile widths, keyboard and increased zoom | Readable controls and unchanged timetable layout | User's earlier 24/24 record; amended live retest pending |

Use real account sign-in or the existing demo switcher. Replace example IDs with stored synthetic IDs; do not fabricate authentication cookies. A refusal must show no data-entry-id timetable entries, and hiding a selector alone is not a pass. Existing production seed guards apply. Do not run seed or db push against a database you need to preserve.

## Scope and limitations

Protected prisma/dev.db and prisma/walkthrough.db were absent in this fresh clone. Neither was created, opened, migrated, seeded, copied or overwritten. All test databases used exclusive temporary directories. The browser fixture used its own temporary database; no browser interaction reached it. The application server was stopped. Cleanup removed only this task's browser/probe directories and the integration suites' own exclusive directories; no tracked repository file was deleted.

Access metadata and the published entry transaction are separate reads; the existing coherent publication snapshot is preserved, but this amendment does not claim atomic protection against simultaneous changes to user/group/teaching ownership during a request. No load or simultaneous-writer race result is claimed.

Academic-data-entry screens, generation conditioned on approved departmental submissions, and redacted venue occupancy remain later work. Report language must continue to distinguish the implemented SQLite responsive web prototype from the report's planned broader system. No claim of operational university deployment or completed browser acceptance is made.

## Publication status

The GitHub integration rejected creation of the commit tree with HTTP 403 Resource not accessible by integration. Direct Git push also failed because no write credential was available. The remote branch was unchanged at base commit 2b0e28fcfa0bfc5789bc7d5511b4bb15c5e5c13a. The verified five-commit patch is supplied as a handoff; do not assume a remote update occurred. Apply it only to a clean local branch, review it, rerun verification and then push using your own authorized Git credentials.

## Pull into local VS Code

With a clean working tree, switch to m4-generator-versions and run git pull --ff-only origin m4-generator-versions. If Git reports divergence or local changes, keep those changes and reconcile them before pulling; do not reset or force-push. Run npm ci if dependencies are not installed, then npm run verify. This amendment does not require a database migration or reseeding.
