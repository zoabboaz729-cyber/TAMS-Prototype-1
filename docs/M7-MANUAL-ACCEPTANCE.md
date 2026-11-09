# M7 owner browser acceptance — PENDING

Perform this yourself after applying the patches and local automated checks. Use synthetic accounts and a **new disposable database**, never your working dev.db/walkthrough.db. Do not share live QR/code/secret screenshots. Record PASS/FAIL/BLOCKED rather than assuming outcomes.

## Setup

1. Follow the ZIP README-VSCODE.md, verify its hashes/base/tree, install dependencies, generate Prisma, migrate/seed only the named new acceptance DB, and run verify/build.
2. Generate and publish a clean timetable with the existing officer workflow; seeds intentionally contain conflicting **draft** data and do not automatically publish a valid timetable.
3. Choose a Semester 1 date within 2026-09-01–2026-12-18 and a published SE-Y4 lesson with its assigned lecturer. Record the actual venue/time and original date. Sign in as that lecturer on the laptop and student1@demo.tams.test on a second browser/device.
4. Live Start/End tests need the real server instant within that scheduled class interval. Do not backdate or use M5's URL demo clock. Optional out-of-hours QR simulation is described below; it does not simulate class activity.

## Scenarios

| ID | Perform | Required observation | Owner result |
|---|---|---|---|
| L1 | View /lecturer/attendance | Only assigned effective classes, venue/date/time and independent controls | PENDING |
| L2 | Start class only after venue confirmation | Activity reported; no attendance session or QR implicitly created; M5 reservation stays | PENDING |
| L3 | Open attendance only on a separate occurrence/fixture | QR/code shown; no class start inferred; M5 says start unconfirmed | PENDING |
| L4 | Start→Open and Open→Start on separate fixtures | Both orders work, no combined action; same original occurrence identity | PENDING |
| L5 | End class while attendance remains open | Scans stop; QR row not silently closed; venue remains reserved to scheduled end | PENDING |
| L6 | Close attendance while class remains started | Further scans denied; class report unchanged; CLOSED cannot reopen | PENDING |
| L7 | Refresh STATIC, then a separate ROTATING session | STATIC stays identical; ROTATING changes at 30-second UTC boundaries; expired code refused | PENDING |
| L8 | Guess another lecturer's class/session URL | No token or private class data | PENDING |
| S1 | Phone over trusted HTTPS/localhost, grant camera permission | Scan yields server-confirmed receipt and stored count increases once | PENDING |
| S2 | Repeat scan; then another eligible student | Duplicate refused, second student's single mark succeeds | PENDING |
| S3 | Deny camera permission / use ordinary LAN HTTP | Clear fallback; typed code still works under same server rules | PENDING |
| S4 | Enter 12 symbols inside 30 seconds on actual phone | Record usability; expired code says retry latest, no silent grace period | PENDING |
| S5 | Lose network during submission | UNKNOWN, no false confirmation; history/retry resolves actual stored state | PENDING |
| S6 | Wrong group, signed out, tampered/expired code | Exact safe rejection, no stored mark or false success | PENDING |
| R1 | Lecturer own-session report and independent Start-only report | Minimal own records; Start-only activity exists without QR session | PENDING |
| R2 | Officer / dept rep / approver / student / ADMIN | Officer/department aggregates only; group-department scope; student own receipts; ADMIN denied | PENDING |
| R3 | Compare reports with independently counted DB rows | Marks, distinct participants, sessions, provisioned accounts and planned size remain distinct | PENDING |
| I1 | M6 ONE_OFF Monday→Tuesday (approve/publish before the original occurrence) | Attendance on actual Tuesday only; original identity retained; next Monday distinct | PENDING |
| I2 | Attempt same-semester publish during live class or QR | Refused; after scheduled end, publication succeeds and history remains | PENDING |
| I3 | M5 live board after neither/Start/QR/End; then M5 URL demo | Truthful reservation labels; no false vacancy; real evidence not projected into simulated URL time | PENDING |
| I4 | Publish replacement in disposable fixture | Archived history retained; old tokens fail; no attendance copied to new draft | PENDING |
| I5 | Regression walkthrough | M0–M6 auth, submissions, generator, views, reschedule, issues, venue functions remain usable | PENDING |
| A1 | Keyboard, narrow screen, zoom, error/empty/offline states | Labels/buttons/status readable; no real data/secret exposure | PENDING |

## Optional isolated synthetic QR demonstration

Use **npm run dev**, DEMO_MODE=true, M7_SYNTHETIC_DEMO=true, DATABASE_URL=file:./m7-demo-<unique-name>.db and M7_DEMO_OFFSET_MINUTES set to an integer offset that places the **advancing server demo clock** inside a real projected published synthetic lesson. The clock offset is server configuration, not a URL/browser field. Only @demo.tams.test actors can open/scan simulated attendance. Prepare/migrate/seed this new database separately, publish a clean timetable and select an SE-Y4 lesson first.

Compute a target offset in PowerShell (replace date/time with that published lesson's actual date and a time inside its interval):

```powershell
$target = [DateTimeOffset]::Parse('2026-11-16T09:15:00+03:00')
$env:M7_DEMO_OFFSET_MINUTES = [string][Math]::Round(($target - [DateTimeOffset]::UtcNow).TotalMinutes)
```

Restart the dev server when changing offset/configuration. QR still rotates every 30 seconds because the clock advances. Simulation must be labelled in lecturer/student screens and reports, separate from live totals, absent from M5's live QR evidence, and refused in production. **Start/End class always use real time**, so test them during their actual interval; simulation is no shortcut to claiming a real class started. Disable simulation and return to a separate fresh acceptance DB before live tests. Semester 2 remains unsupported until explicitly configured.

## Acceptance record

- Tested local commit and tree:
- Database filename (new disposable, synthetic):
- Server real clock / simulation mode, offset and scan policy:
- Laptop OS/browser/version and viewport:
- Phone OS/browser/version and trusted HTTPS/localhost context:
- Synthetic lecturer/group/session and original→actual occurrence dates:
- Per-ID PASS / FAIL / BLOCKED, defect and retest notes:
- Owner decision: **PENDING — M7 NOT ACCEPTED/CLOSED**

Return this record or an explicit acceptance report. Automated/static/HTTP results do not fill it automatically.
