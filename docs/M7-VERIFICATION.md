# M7 verification and owner acceptance handoff

Status: M7 ACCEPTED/CLOSED on 9 November 2026: implementation and automated verification passed, and the owner reported successful completion of manual acceptance. No M8 or M9 implementation is included.

Repository: zoabboaz729-cyber/TAMS-Prototype-1. Branch: m7-qr-attendance.
Base: b33098ff3f0d6bdc031d7ae49450acefe1774723 (identical master/m7 at preflight and final remote check).
Tested implementation commit: 8f382a402ef444b5ce49824de01c1af753638c9a.
Tested implementation tree: 68a7a81233e995af744de0eb51c895945d3871af.
Final documentation commit and its replay tree are recorded externally in the ZIP evidence to avoid recursive self-hashing.

## Summary and files changed

All M7-T1–T4 and approved M7-V0–V5 features are implemented: effective dated occurrence sessions; STATIC/ROTATING HMAC QR and 12-character fallback; authenticated group-scoped scans and DB duplicate barrier; independent Start/End and Open/Close; live confirmed counts; scoped reports/history; truthful M5 overlay; atomic M4 active-class publication gate; retained history and legacy undated rows. See M7-IMPLEMENTATION.md and the ZIP changed-file manifest for the exact scope.

## Actual automated evidence

- npm run verify: PASS, typecheck/lint, **1760/1760 tests across 77 files**, separate seed check **11/11**. Full real output is docs/M7-verification.txt and ZIP evidence/25-publication-clock-verify.txt. Initial failures and their corrected runs are retained in the ZIP; no assertions were skipped or weakened.
- npm run build: PASS on implementation and clean patch replay, with all three new pages and three API endpoints in the route table. QR scanner is dynamically imported, with SSR and camera-controller tests; this does not certify camera hardware behavior.
- Exact patch replay: all six implementation patches applied in order with git am --keep-cr from the exact remote base. npm run verify ran after **every committed tree**. Each source/replay tree matched, and final replay production build passed. Original and replay commit IDs differ because git am regenerates committer metadata; code trees match exactly.
- Real SQLite: all migrations deploy on empty fixtures; M6 upgrade retains every original field/row, including old attendance/device data, with nullable occurrence dates rather than guessed history. FK checks pass; composite provenance, occurrence/mark uniqueness, Restrict deletes, duplicate requests, two students, transaction-time expiration, wrong roles/groups, ONE_OFF and archived history are tested.
- Failure injection proves atomic audit rollback for open, close, scan and class activity. M4 publication is refused during a same-semester active real class/QR and succeeds after scheduled end, retaining history. Concurrent publication/open and same-student scans exercise real SQLite with safe retriable results; no production-scale throughput claim.
- Scoped report totals reconcile with independent SQLite COUNT(*); distinct participants differ from total marks across sessions. Visiting/service lecturers follow the student group's department. ADMIN denied; students get only their own receipts; department/officer projections are aggregate-only. Start-only class reports need no QR row.
- Fresh disposable database migrated and seeded twice: counts match. Standard npm run seed hit an environment Unix IPC restriction in tsx; the **same seed** ran successfully twice via node --import tsx prisma/seed.ts. Both original failure and successful logs are preserved. No product code was changed to hide the restriction.
- Actual production server: **11/11 HTTP checks pass**, covering signed-out redirects/401s, authenticated student/lecturer pages, student token denial, ADMIN report denial and private API headers. npm run dev separately passed the same **11/11** HTTP checks. These are not browser/camera acceptance.
- Dependencies pinned: qrcode 1.5.4, html5-qrcode 2.3.8, @types/qrcode 1.5.6. Lock comparison proves no existing package version changed. npm audit still reports 15 known advisories (8 moderate, 5 high, 2 critical), matching the pre-existing M6 count; none lists these QR packages. No general dependency upgrades were authorized or performed. Scanner upstream maintenance mode remains a limitation.
- git diff --check passes. No secrets, real personal data, .env, node_modules or DBs are committed. Protected local databases were absent in this clone and were not opened, migrated, reset or copied.

## Acceptance criteria

- [x] M7-T1 signed credentials, exact boundaries, eligibility, uniqueness, safe migration and adversarial tests.
- [x] M7-T2 lecturer own effective published occurrence, independent controls, locally generated QR and stored live count; wrong lecturer denied.
- [x] M7-T3 camera/typed transports, strict server confirmation, UNKNOWN on lost response, device-ID STUB and cleanup/SSR tests.
- [x] M7-T4 own-session / unit / department / SELF reports, honest denominators and independently reconciled totals.
- [x] M7-V0–V5 role permission, independent state/projection/persistence/actions, no false room release, M5 integration and publication safeguards.
- [x] Owner reported completion of M7-MANUAL-ACCEPTANCE.md with everything behaving as expected; scenario results are collectively owner-reported, not agent-observed device measurements.
- [x] Owner explicit M7 acceptance recorded on 9 November 2026; M7 closed for the approved prototype scope.

## Owner acceptance record — 9 November 2026

The owner stated: "I have done manual acceptance and everything is as expected and okay." This supersedes the pending manual-acceptance status in the original delivery and M7-APPLY handoff. The checklist records PASS on that collective report, without inventing individual observations.

At recording time the repository is at local/remote m7-qr-attendance commit 0ee49f98068baffec32f9c67c9c57d3d94c23121, tree 442b726db1d36201102ea75af94ebd0b6746d940. These are observed repository identifiers, not a claim about the exact revision the owner tested. The owner did not supply tested commit/tree, database, clock/simulation configuration, browser/OS/device/HTTPS context, occurrence identifiers, per-scenario measurements or defect notes. No such metadata is inferred. This acceptance does not change the limitations below.

## Decisions and limits

All implementation defaults are owner-approved **synthetic prototype settings**, not confirmed Kisii University policy. QR can be photographed/shared; it is not physical-presence proof. Device binding remains a labelled random-ID stub. Semester 1 dates 2026-09-01–2026-12-18 are synthetic; Semester 2 remains TERM_NOT_CONFIGURED. Opening and Start use scheduled intervals; CLOSED is terminal; End blocks scans without closing attendance; no backdating, automatic absence verdict, room release, corrections or export of personal records.

Simulation is optional and fail-closed: nonproduction, DEMO_MODE=true, M7_SYNTHETIC_DEMO=true, a local m7-demo-*.db filename, bounded server-configured offset and synthetic actor emails. Synthetic marks are tagged and aggregated separately; they never overlay the live M5 board. Start/End class always use the real server clock. The M5 URL clock cannot authorize any M7 write. Failed typed-code attempts are five per account/session per rolling reset window of five minutes, with lazy cleanup after 24 hours on authorized code requests; no code/token is retained.

Legacy attendance rows with missing occurrence provenance remain retained history, never live eligibility. Explicit source dates and an approved repair are required before operating them. Current reports rely on preserved entry/teaching references; there is no UI for editing historical published entries. Deploy only against an explicitly selected disposable acceptance database until the owner authorizes migration of their working data.

## Remote delivery and deletion record

During the original delivery, the GitHub integration refused preparation of an implementation blob with HTTP 403 and direct git push dry-run lacked credentials; that source handoff changed no remote history. The subsequent local application successfully pushed all seven delivered commits and the integration record to origin/m7-qr-attendance at 0ee49f98068baffec32f9c67c9c57d3d94c23121. See PROGRESS.md M7-APPLY for local evidence. The current owner instruction additionally authorizes this acceptance-documentation commit/push, followed by merging M7 into master and preparing m8-meeting-tools-polish; no M8 feature implementation is included.

Deletion operations were confined to task-owned temporary fixture directories (test rmSync and HTTP harness shutil.rmtree), seed deleteMany operations on newly created disposable synthetic databases, and npm ci replacing task-owned dependencies. No rm, git clean, reset --hard, user-folder deletion, protected DB reset, force push or test weakening was performed.

## Open questions

No M7 implementation-policy or owner-acceptance blocker remains reported. Detailed device/fixture metadata was not supplied, and institutional validation remains outside this prototype acceptance. Existing limits remain in force; M8 implementation awaits separate task authorization.
