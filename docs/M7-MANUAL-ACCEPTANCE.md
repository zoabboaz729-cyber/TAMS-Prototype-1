# M7 owner browser acceptance — ACCEPTED/CLOSED (owner-reported)

On 9 November 2026, the owner reported: "I have done manual acceptance and everything is as expected and okay." M7 is accepted and closed for the approved prototype scope. The scenario results below record that collective owner report, not separately observed agent tests; detailed device, fixture and per-scenario measurements were not supplied.

The setup and scenarios remain available for repeat testing. Use synthetic accounts and a **new disposable database**, never your working dev.db/walkthrough.db. Do not share live QR/code/secret screenshots. Record actual PASS/FAIL/BLOCKED outcomes for any future retest.

## Setup

1. Follow the ZIP README-VSCODE.md, verify its hashes/base/tree, install dependencies, generate Prisma, migrate/seed only the named new acceptance DB, and run verify/build.
2. Generate and publish a clean timetable with the existing officer workflow; seeds intentionally contain conflicting **draft** data and do not automatically publish a valid timetable.
3. Choose a Semester 1 date within 2026-09-01–2026-12-18 and a published SE-Y4 lesson with its assigned lecturer. Record the actual venue/time and original date. Sign in as that lecturer on the laptop and student1@demo.tams.test on a second browser/device.
4. Live Start/End tests need the real server instant within that scheduled class interval. Do not backdate or use M5's URL demo clock. Optional out-of-hours QR simulation is described below; it does not simulate class activity.

## Scenarios

| ID | Perform | Required observation | Owner result |
|---|---|---|---|
| L1 | View /lecturer/attendance | Only assigned effective classes, venue/date/time and independent controls | PASS (owner report) |
| L2 | Start class only after venue confirmation | Activity reported; no attendance session or QR implicitly created; M5 reservation stays | PASS (owner report) |
| L3 | Open attendance only on a separate occurrence/fixture | QR/code shown; no class start inferred; M5 says start unconfirmed | PASS (owner report) |
| L4 | Start→Open and Open→Start on separate fixtures | Both orders work, no combined action; same original occurrence identity | PASS (owner report) |
| L5 | End class while attendance remains open | Scans stop; QR row not silently closed; venue remains reserved to scheduled end | PASS (owner report) |
| L6 | Close attendance while class remains started | Further scans denied; class report unchanged; CLOSED cannot reopen | PASS (owner report) |
| L7 | Refresh STATIC, then a separate ROTATING session | STATIC stays identical; ROTATING changes at 30-second UTC boundaries; expired code refused | PASS (owner report) |
| L8 | Guess another lecturer's class/session URL | No token or private class data | PASS (owner report) |
| S1 | Phone over trusted HTTPS/localhost, grant camera permission | Scan yields server-confirmed receipt and stored count increases once | PASS (owner report) |
| S2 | Repeat scan; then another eligible student | Duplicate refused, second student's single mark succeeds | PASS (owner report) |
| S3 | Deny camera permission / use ordinary LAN HTTP | Clear fallback; typed code still works under same server rules | PASS (owner report) |
| S4 | Enter 12 symbols inside 30 seconds on actual phone | Record usability; expired code says retry latest, no silent grace period | PASS (owner report) |
| S5 | Lose network during submission | UNKNOWN, no false confirmation; history/retry resolves actual stored state | PASS (owner report) |
| S6 | Wrong group, signed out, tampered/expired code | Exact safe rejection, no stored mark or false success | PASS (owner report) |
| R1 | Lecturer own-session report and independent Start-only report | Minimal own records; Start-only activity exists without QR session | PASS (owner report) |
| R2 | Officer / dept rep / approver / student / ADMIN | Officer/department aggregates only; group-department scope; student own receipts; ADMIN denied | PASS (owner report) |
| R3 | Compare reports with independently counted DB rows | Marks, distinct participants, sessions, provisioned accounts and planned size remain distinct | PASS (owner report) |
| I1 | M6 ONE_OFF Monday→Tuesday (approve/publish before the original occurrence) | Attendance on actual Tuesday only; original identity retained; next Monday distinct | PASS (owner report) |
| I2 | Attempt same-semester publish during live class or QR | Refused; after scheduled end, publication succeeds and history remains | PASS (owner report) |
| I3 | M5 live board after neither/Start/QR/End; then M5 URL demo | Truthful reservation labels; no false vacancy; real evidence not projected into simulated URL time | PASS (owner report) |
| I4 | Publish replacement in disposable fixture | Archived history retained; old tokens fail; no attendance copied to new draft | PASS (owner report) |
| I5 | Regression walkthrough | M0–M6 auth, submissions, generator, views, reschedule, issues, venue functions remain usable | PASS (owner report) |
| A1 | Keyboard, narrow screen, zoom, error/empty/offline states | Labels/buttons/status readable; no real data/secret exposure | PASS (owner report) |

## Optional isolated synthetic QR demonstration

Use **npm run dev**, DEMO_MODE=true, M7_SYNTHETIC_DEMO=true, DATABASE_URL=file:./m7-demo-<unique-name>.db and M7_DEMO_OFFSET_MINUTES set to an integer offset that places the **advancing server demo clock** inside a real projected published synthetic lesson. The clock offset is server configuration, not a URL/browser field. Only @demo.tams.test actors can open/scan simulated attendance. Prepare/migrate/seed this new database separately, publish a clean timetable and select an SE-Y4 lesson first.

Compute a target offset in PowerShell (replace date/time with that published lesson's actual date and a time inside its interval):

```powershell
$target = [DateTimeOffset]::Parse('2026-11-16T09:15:00+03:00')
$env:M7_DEMO_OFFSET_MINUTES = [string][Math]::Round(($target - [DateTimeOffset]::UtcNow).TotalMinutes)
```

Restart the dev server when changing offset/configuration. QR still rotates every 30 seconds because the clock advances. Simulation must be labelled in lecturer/student screens and reports, separate from live totals, absent from M5's live QR evidence, and refused in production. **Start/End class always use real time**, so test them during their actual interval; simulation is no shortcut to claiming a real class started. Disable simulation and return to a separate fresh acceptance DB before live tests. Semester 2 remains unsupported until explicitly configured.

## Acceptance record

- Acceptance date: 9 November 2026.
- Owner report: "I have done manual acceptance and everything is as expected and okay."
- Repository revision when recorded: 0ee49f98068baffec32f9c67c9c57d3d94c23121; tree 442b726db1d36201102ea75af94ebd0b6746d940. These identify the observed repository, not an independently confirmed owner-tested revision.
- Tested local commit and tree: not supplied by the owner.
- Database filename (new disposable, synthetic): not supplied by the owner.
- Server real clock / simulation mode, offset and scan policy: not supplied by the owner.
- Laptop OS/browser/version and viewport: not supplied by the owner.
- Phone OS/browser/version and trusted HTTPS/localhost context: not supplied by the owner.
- Synthetic lecturer/group/session and original→actual occurrence dates: not supplied by the owner.
- Per-ID PASS / FAIL / BLOCKED, defect and retest notes: PASS recorded from the collective owner report; no individual measurements or defect notes supplied.
- Owner decision: **M7 ACCEPTED/CLOSED — owner-reported successful manual acceptance.**

Additional fixture/device details may be appended if supplied. Automated/static/HTTP results are separate evidence and do not replace the owner's manual report.
