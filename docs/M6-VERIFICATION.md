# M6 verification and acceptance handoff

## Summary
All revision-2 M6 features are implemented: WEEKLY and ONE_OFF requests, cancellation/history, officer preview/rejection/override, audited immutable draft branching, M4 dated publication safeguards, protected dated timetable views, sanitized date-aware M5 status, and issue reporting/status queues. The explicitly revised cohesive commit map is in M6-IMPLEMENTATION.md. No M7 implementation is included.

Base: `2f2df40f5b4910d6d44d2f8befa8db6f5896c0dd`, branch `m6-change-handling`.
Tested code commit: `314f62b3a2fb3e3d4e1b12462fc806e6982c1723`. Final handoff hash/tree and replay values are in the ZIP evidence.
GitHub was rechecked and remains at the base; there was no push, merge or remote write.

## Files changed
See the exact changed-file manifest in the ZIP. Changes cover M6 domain/schema/services/actions/pages, required M4/M5 seams, permission/menu expectations and documentation. Dependencies, seed meaning, PROTOTYPE_SPEC.md, AGENTS.md and unrelated tracked files remain unchanged. Original documentation line endings are preserved in the final tree.

## Verify output
Full actual output: M6-verification.txt and the ZIP evidence.

- Full `npm run verify`: PASS; typecheck/lint, **1672/1672 tests across 68 files**, seed **11/11**. Tests used RUST_LOG=info and a nonprotected DATABASE_URL.
- `npm run build`: PASS, production compilation/typecheck and 19/19 static-page generation. New protected dynamic routes appear in the route table.
- Prisma validate/generate/deploy/status: PASS on disposable SQLite. Upgrade tests retain every original field/row across all legacy domain tables; they verify WEEKLY/default pending-claim backfill, uniqueness/FKs and atomic refusal of duplicate legacy pending claims.
- Focused SQLite lifecycle, action and presentation tests cover audit/copy-failure rollback, concurrent approval calls, stale previews/publications, source/term/availability drift, historical exception preservation, effective-date scopes, visiting lecturers and issue escaping/pagination.
- HTTP `npm run dev` smoke: all seven protected routes return 307 /login when signed out. This is not browser acceptance.
- Every delivered commit receives full exact-tree verification during ordered patch replay. Apply with `git am --keep-cr`; otherwise the repository's CR-containing documentation context is stripped. Final replay tree equality is independently recorded outside this commit.
- An unchanged legacy M5 deliberately-corrupt-data SQLite fixture intermittently failed before product assertions: its intended foreign-key-corrupting UPDATE was refused. Two replay attempts failed and passed unchanged on retry; both failure and successful logs are retained. No assertion was weakened or skipped.

## Acceptance criteria
- [x] Atomic additive migration, empty/upgrade fixtures, original-row preservation, pending uniqueness and link integrity.
- [x] WEEKLY request/cancel/review/reject/approve/new-draft/publication lifecycle.
- [x] ONE_OFF suppresss exactly one source occurrence, adds one replacement, preserves unrelated weeks and supports same-day moves.
- [x] Stored request/draft/source provenance; all entries/exceptions copied with remapped IDs; publication and other drafts/semesters remain unchanged during approval.
- [x] Whole-week/per-date M3 validation, baseline/candidate diagnostics, operational room checks and incomplete fail-closed behavior.
- [x] Note-required override creates only a repair draft; incomplete/illegal dates cannot be overridden. Draft-only dated repair controls are provided.
- [x] Extended atomic M4 snapshot/provenance gate; stale alternatives cannot erase newly published changes; historical exceptions retained.
- [x] Protected dated role perspectives, including visiting lecturers scoped per group department; public M5 output stays sanitized.
- [x] Live actual date, officer/admin dated demo and honestly labelled generic weekday demo.
- [x] Issue submission, home-department ownership, precise officer CAS/audit transitions, stable 25-row scoped pagination, guards and escaped text.
- [x] No new dependency, protected-database modification, notification or M7 feature.
- [ ] Owner manual browser acceptance for both reschedule modes and issue reporting.
- [ ] M6 closure: current status is IMPLEMENTED / AUTOMATED VERIFIED / PENDING OWNER ACCEPTANCE.

## Open questions and limits
Semester 1 dates 2026-09-01 through 2026-12-18 are synthetic; semester 2 has no configured dated window. Africa/Nairobi is a provisional campus reference zone. No official holidays/calendar, production-load assurance or historical-attendance claim is made. Lecturer proposals retain their source venue; publication remains one current version per semester. Occurrence metadata is only an M7 interface seam. Institutional questions remain in the design.

Protected prisma/dev.db, prisma/walkthrough.db, companions and .env were absent in the fresh clone and remain untouched. Cleanup deletes only test-owned temporary fixtures and task-created intermediate files. The combined draft domain test was split into four focused tests; a duplicate intermediate patch was regenerated before packaging. A local rebase consolidated the agent's unpushed migration-fixture correction; no remote history was changed.
