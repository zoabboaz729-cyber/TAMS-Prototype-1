# M8 verification and acceptance report

**Implementation automated gates: PASS. Owner acceptance: PENDING.** Date: 9 November 2026 (Africa/Nairobi). No master merge, deployment or M9 work.

Verified target baseline: `a41cb7d6071c3e6c10cbd6008d2725add9b168c9`, exact tree `2df491eb93ad124d6a35cb69c7804eecdebf5936`. Retrieved files reproduced that tree byte-for-byte. The original baseline commit object was reconstructed and SHA-verified; all clean patch replays start at the actual exact base. The local source commit is `ef72ea625851780c15a466a5fa6e03051973a7fd`, tree `48dcadcd94acd76a7dbfee62a81426bdc5199675`. Replay commit IDs can differ because git am uses a new committer timestamp; every source/replay tree is identical. Final documentation-commit replay/tree evidence stays outside its own commit in the delivery ZIP to avoid recursive self-hashing.

## Executed checks

| Check | Result | Evidence |
|---|---|---|
| `npm run verify` | PASS: typecheck; lint; **1814/1814 tests in 85 files**; seed integrity **11/11** | M8-verification.txt; delivery evidence/M8-readiness-hardening.txt |
| Production `npm run build` | PASS | M8-verification.txt; evidence/final-build.txt |
| `npx prisma validate` | PASS | M8-verification.txt; evidence/prisma-validate.txt |
| Empty and pre-M8 migrations | PASS actual Prisma migrate deploy; all prior fields/rows retained, nullable provenance, FK checks | m8Fixture.ts; m8Migration.test.ts |
| Each implementation commit clean replay + verify | PASS; final tree equal | evidence/replay-results.json and per-commit raw logs |
| Live browser smoke | BLOCKED | evidence/browser-smoke.txt and browser-smoke-retry.txt: missing bundled executable, then installed Chromium socket/process restriction |
| Owner laptop/phone/camera/keyboard walkthrough | PENDING | M8-MANUAL-ACCEPTANCE.md |
| Remote write | DENIED HTTP 403, Resource not accessible by integration | No remote mutations; branch rechecked at original baseline |

Commands use only locked dependencies from `npm ci`. This runtime requires `RUST_LOG=info` for reliable Prisma schema-engine diagnostics. CLI fixture tests use `node --import tsx` to avoid the restricted container IPC used by the tsx CLI. These are execution-environment settings, not code/test/dependency weakening. No tests are skipped in the passing runs.

## Separate commit map

| Slice | Source commit and scope | Replay verify |
|---|---|---|
| 1 | `39a8fc3` M8-T1a: add canonical assumptions, additive findings migration and audited idempotent capture | PASS |
| 2 | `40f8354` M8-T1b: deliver private presenter feedback UI and chronological CSV endpoints | PASS |
| 3 | `5425070` M8-T2a: guard atomic sample reset and CLI seed against findings loss | PASS |
| 4 | `6aa4cf0` M8-T2b: add guided discovery script, honest readiness and role navigation | PASS |
| 5 | `3ffff71` M8-T2c: clarify flow states and verify complete synthetic discovery lifecycle | PASS |
| 6 | `ef72ea6` M8-T2d: require eligible QR students and safe fixture readiness | PASS |

The documentation/handoff is a seventh commit. The attached per-file manifest and git patches provide the exact changed paths; 45 files change through the six source commits, including progress/decisions/configuration. No package files or approved institutional policy were changed. The owner's explicit M8 file-cap waiver applies.

## Acceptance matrix

| Blueprint criteria | Automated outcome and proof | Remaining manual work |
|---|---|---|
| A01–A02 canonical 18 and unreviewed | PASS assumptions.test.ts, server-rendered catalog tests | Laptop/phone review |
| A03–A08 persisted verdicts, validation, append-only, idempotency, audit rollback | PASS m8Feedback.test.ts: real SQLite, concurrent retries, mismatched key conflict, injected audit failure; actual route tests | Presenter workflow acceptance |
| A09–A10 roles/provenance/privacy | PASS real guarded handlers deny signed-out/nonpresenters; no unauthorized writes; escaped render; catalog does not read/serialize private findings for student | Cross-role browser confirmation |
| C01–C05 chronological CSV and failures | PASS assumptions.test.ts and m8Routes.test.ts: empty header, quoting/CRLF/Unicode, formula triggers including Unicode control/format prefixes, corrected history/latest ordering, private caching and 503 instead of empty file | Excel/other spreadsheet import |
| D01–D03 actual seeded preparation and publication | PASS m8EndToEnd.test.ts: original conflicts refuse publication; original lab mismatch refuses generation; explicit synthetic venue edit allows valid generation then guarded publication | Rehearsal/timing |
| D04–D06 clock and attendance controls | PASS unchanged M7 tests plus full seeded lifecycle: independent start/open, stored valid mark, duplicate rejection, real-time class activity separate from QR simulation | Actual phone/camera, published lesson timing |
| D07 / R03 exact feedback preservation | PASS reset twice, exact rows/timestamps/provenance, capture audits and user identity; byte-identical CSV, original seed restored | ADMIN browser reset and inspect |
| R01–R02 strict reset gates | PASS policy/route/canonical path tests; no GET export of reset handler; typed confirmation; forged/missing origin; non-loopback host guard in route; flags and roles fail closed | Disabled-mode browser behavior |
| R04–R05 rollback/unexpected data | PASS injected mid-reset failure, unknown user/venue, symlink and actual connection mismatch; concurrent capture/reset retains every committed finding | No protected DB should be used for a manual destructive test |
| R06 CLI guard/determinism | PASS CLI refusal with findings before deletes; two seed runs on separate zero-findings fixture retain logical seed rows/counts | Operator follows new guard instructions |
| U01 explicit states | PASS existing regression suites and guarded rendered-page tests; FlowStatus and safe error boundaries; scanner's original UNKNOWN semantics retained | Offline/browser recovery and accessible focus |
| U02 keyboard/phone/screen-reader | PENDING (semantic labels and server escaping inspected/tested; no browser pass inferred) | Owner/device acceptance |
| X01–X03 regressions, migration, seeded whole path | PASS 1814 tests, actual migration fixtures, named disposable full lifecycle; exact clean replay | Owner walkthrough |

## What initial failures established

Raw development logs are retained, including failed attempts. Permission/menu expectations were expanded only for authorized M8 additions while preserving the existing timetable-first navigation invariant. A new test incorrectly assumed four total seed entries (the actual seed has ten), and a new seed-determinism check initially compared operational timestamps that intentionally renew. Those new assertions were corrected to the established seed contract; preserved feedback/user timestamps remain exact. The full walkthrough exposed the real LAB1 capacity prerequisite, now explicitly documented and tested without changing seed meaning or weakening validation. The ADMIN lock initially changed updatedAt; the implementation was fixed to preserve the row exactly.

Initial schema-engine failures were resolved by RUST_LOG diagnostics; tsx CLI IPC failures by the Node import launcher. No existing accepted test was removed, skipped or weakened. Full failed/passing raw outputs are included rather than reclassified as success.

## Git and acceptance boundary

GitHub create-blob was rejected with HTTP 403. Direct clone was unavailable, so the authenticated connection supplied the baseline and exact hash/tree were verified locally. Remote `m8-meeting-tools-polish` was rechecked and remains `a41cb7d`; master is untouched. The seven numbered patches replay cleanly against that exact baseline. Use README-VSCODE.md. Do not apply to a dirty or different head, merge master, run a working-database reset or start M9 as part of this handoff.

M8's implementation is delivered; it is not ACCEPTED/CLOSED until the owner completes the manual checklist. University workflow, term dates, authority, workload, capacity exceptions, device availability and attendance requirements remain questions for discovery.
