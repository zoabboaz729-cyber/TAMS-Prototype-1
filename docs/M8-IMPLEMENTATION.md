# M8 implementation handoff

M8 is implemented for stakeholder discovery, with automated verification and a separate pending owner walkthrough. No institutional policy is certified. SQLite remains; M9 is not implemented. The owner authorized full M8 and waived the five-file cap. No dependencies, protected databases, AGENTS.md, PROTOTYPE_SPEC.md, or accepted M6/M7 evidence were changed.

## Delivered behavior

- `/assumptions`: all 18 unvalidated canonical statements and suggested discussion prompts. Every signed-in role can read the catalog. Only demo OFFICER/ADMIN presenters may capture or read findings/history/export. Participant accounts and public write endpoints are absent.
- Capture is POST-only, strictly same-origin (missing Origin is rejected), bounded to 16 KiB actual streamed bytes, Zod-validated and authorized again in the transactional service. A nullable unique submission key backs retry safety. Matching committed payloads reuse their receipt; different payloads conflict. The current demo actor is checked in the database, not accepted from form data. Feedback and `ASSUMPTION_FEEDBACK_CAPTURED` audit commit together.
- Feedback is append-only. Nullable migration adds meeting label, optional speaker role, recorded demo operator role and idempotency key without replacing legacy records. Null historical provenance displays as “not recorded”. Speaker role and demo account role are distinct. No feedback edit/delete route exists.
- Private export includes every event chronologically by timestamp/id, all exact specified columns, UTC times and deterministic latest flags. RFC 4180 quoting and CRLF preserve punctuation/newlines; formula triggers after whitespace, control or format characters are neutralized. Empty storage produces a header-only CSV; query failure produces 503. Export has private/no-store caching. For Excel, import as UTF-8 text/CSV.
- `/demo`: seven linked role-aware discovery stages, timing caveat, questions, recovery instructions and links back to durable assumption capture. Semester 1 readiness distinguishes unprepared publication/attendance from storage failure. No secrets or DB paths are rendered.
- Reset is POST-only, same-origin, loopback-host-only, synthetic ADMIN-only, nonproduction, explicitly enabled, exact-confirmation and double-target gated. Canonical files must be directly inside `prisma/`, regular, single-link files with no symlink. PRAGMA database_list must identify the same actual database. An atomic write lock precedes synthetic-record validation and restoration. Unknown users/master records or unsafe relations refuse/roll back.
- Reset retains every feedback row, its timestamps and provenance, all capture audit rows, and fixed seeded user identities/password hashes/timestamps. Operational audit rows are cleared; no optional reset audit is added. All other operational seed records are restored with their original meaning. Creation/update timestamps of recreated operational rows may renew; logical seed rows/counts are deterministic. The original DRAFT, 10 entries and exactly two planted clash pairs return.
- CLI seed is now atomic and refuses before any deletion if findings exist. No override or browser shell command is exposed. It still performs destructive synthetic seeding when there are zero findings; use only an isolated fixture.
- Shared explicit flow states improve assumptions, guide, lecturer attendance, student scan, reports, venue status and departmental empty states. Draft/submission/review have safe retry error boundaries. Existing rich timetable/draft validation messages and scanner UNKNOWN-receipt semantics are preserved.

## Reconciled implementation details

1. The suggested blueprint micro-slices are consolidated into cohesive commits: T1a catalog/schema/permissions/service/CSV tests and migration; T1b presenter UI/private endpoints/shared status; T2a reset policy/transaction/route/CLI guards; T2b guide/readiness/navigation; T2c focused page polish and seeded lifecycle; T2d final readiness hardening; T3 documentation. All are independently verified via clean patch replay. File cap explicitly waived.
2. The original seed includes 10 timetable entries: four rows create two clash pairs and six rows are clean. It does not contain only four total entries.
3. Original LAB1 capacity is 40 and sample SE-Y4 size is 45. Full generation correctly refuses `NO_COMPATIBLE_VENUE`. Guide stage 3 explicitly uses the existing venue edit screen to set LAB1 to 50 **only in the disposable synthetic rehearsal**. This is neither a seed change nor a statement about a real room. The lifecycle test proves refusal before preparation, successful validated generation/publication after it, and restoration to 40 on reset.
4. Existing M7 synthetic-clock policy only accepts `m7-demo...db`. M8 allows the dedicated `m7-demo-m8-<label>.db` prefix as well as `m8-demo-<label>.db`. Use the first for the complete walkthrough. No M7 runtime, token, publication or M5 clock rule changed.
5. M7 simulated QR time cannot enable real-time Start class. Demonstrate that control only within a real matching class interval; otherwise explain its correct refusal. Automated fixtures explicitly pass separate real/synthetic clocks. QR sharing/device STUB and absent semester 2 calendar remain limitations.

## Reset order and deletion inventory

Within the allowlisted synthetic transaction: attempts → class activity → attendance records → sessions → reschedule requests → occurrence exceptions → entries → clear version parent references → versions → issues → submissions → teaching → lecturer availability → lecturers → units → venue unavailability → venues → non-capture audits. Seed departments/groups reconcile in place, then original operational fixtures are recreated. Users, feedback and capture audits are not deleted. A database failure at any point rolls back every deletion. Guard/rollback tests and full seeded attendance lifecycle exercise actual SQLite foreign keys.

The lifecycle test records one attendance mark before reset and zero afterward, with three findings and three capture audits retained. Detailed before/after counts are returned by the guarded reset API; tests check exact findings/audit identity, repeated reset, concurrent capture/reset and FK integrity. CLI two-run determinism is checked on a separate no-findings fixture.

## Local disposable configuration

Use `npm ci`, copy `.env.example` locally, configure a new unique SQLite file and local synthetic secrets. Never commit `.env` or DB files. Example non-sensitive settings:

```dotenv
DATABASE_URL="file:./m7-demo-m8-meeting-01.db"
DEMO_MODE=true
M8_DEMO_RESET_ENABLED=true
M8_DEMO_RESET_DATABASE_URL="file:./m7-demo-m8-meeting-01.db"
```

Set DEMO_PASSWORD and distinct SESSION_SECRET/ATTENDANCE_TOKEN_SECRET using the existing example requirements. Run `npx prisma migrate deploy`, then `npm run seed` only on that new disposable database, then `npm run dev`. Reset is unavailable in a production build or from a remote host. Do not switch a running process to a different database; restart it with consistent settings. Use a different disposable database for rehearsal.

For synthetic QR set `M7_SYNTHETIC_DEMO=true` and an integer `M7_DEMO_OFFSET_MINUTES` within the existing supported range to put the server inside a published Semester 1 class. The shift is server configuration, not a browser URL. Use the same supported sample cohort for lecturer/student role switching. Camera still requires HTTPS or localhost and permission; typed code is available. No public reset deployment is authorized.

## Verification and known limits

All automated results and clean replay/tree evidence are in M8-VERIFICATION.md and raw logs. Test cleanup removes only task-created temporary database fixtures/directories/sidecars. The three safe error boundaries do not reveal raw exceptions. This task did not delete user files or run a destructive reset against a protected database.

The local browser smoke could not launch: the bundled Playwright executable was absent, and installed Chromium was blocked by process/socket restrictions. No browser/device/keyboard/phone/camera acceptance is claimed. Server-rendered escaping, role/privacy, real route tests and real SQLite lifecycle coverage passed. Owner completes M8-MANUAL-ACCEPTANCE.md before closing M8 or merging master.
