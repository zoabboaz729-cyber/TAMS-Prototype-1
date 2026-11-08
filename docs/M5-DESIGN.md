# TAMS Prototype 1 — M5 Venue Status & Demo Clock
## Design baseline, contracts, task breakdown, tests, and acceptance gates

**Design revision:** 1.0 — 8 November 2026

**Status:** proposed implementation design; no M5 code has been changed by this review.

**Target branch:** `m5-development`

**Verified remote starting SHA:** `078fd71dfe10dd3e22a5da58ea15613299a5dc7f`

**Repository:** https://github.com/zoabboaz729-cyber/TAMS-Prototype-1/tree/m5-development

## 0. Evidence and authority

Authoritative repository sources inspected at the verified SHA:
- `AGENTS.md` — agent, test, security, prototype, Git and non-destructive rules.
- `PROTOTYPE_SPEC.md` §§1–14, particularly §7 policy, §8 permissions, §9 assumptions, §11 M5, §12 demo, §13 done.
- `PROGRESS.md` and `DECISIONS.md` — M4-T4i accepted/closed, explicit M5 hold, historical caveats.
- `docs/M4-T4h.md` — user-reported 24/24 and 8/8 browser checks, M4 least-privilege read policy, known caveats.
- `prisma/schema.prisma`; `src/domain/{types,policy,permissions,menu,seedData,publishedTimetableAccess}.ts`.
- `src/server/{guards,publishedTimetable,publishedTimetableContract,publishedTimetableStorePrisma,venueData}.ts`.
- `src/app/{page,timetable/page,venues/page,layout}.tsx` and relevant tests.

**Observed facts, not proposals:** M5's official scope is `M5-T1` pure venue status and `M5-T2` venue board + demo clock. `m5-development`, `m4-generator-versions`, and `master` were each remotely observed at the same SHA. The menu already contains `/venues/status` but marks it `built: false`. The permission matrix gives `VIEW_VENUE_STATUS: ALL` to each of the six existing roles. The schema has `Venue.status` (ACTIVE/INACTIVE/MAINTENANCE), `VenueUnavailable` (day/start/end/reason), `TimetableVersion` (semester/status/publishedAt), `TimetableEntry` (venue/day/start/end). Seed data includes 9 venues, two venue unavailability periods and **a conflicted DRAFT** (`ver-s1-planted`); the seed is *not* itself a valid current published timetable. M4 already implements current-publication reads and version checks, but its user-facing readers deliberately restrict timetable contents by role.

The last accepted M4-T4i verification record reports: `npm run verify` success, 1353/1353 Vitest tests across 56 files, seed integrity 11/11, and production build success. These are historical M4 results, not a claim that commands were run during this M5 design.

**Proposed decisions below are not already approved university rules.** They must be recorded with the M5 implementation in `DECISIONS.md`; if implementation diverges, reconcile before coding rather than silently inventing behavior.

## 1. Mission, outcomes, and acceptance definition

**Business goal:** At the Kisii University timetabling-office demonstration, show the schedule-derived state of each room/lab/hall for a selected semester and day/time, and let an officer move a *simulated* clock to illustrate free/occupied/upcoming/unavailable transitions without changing stored academic data.

Success is **not** proving an attendee is physically inside a room, that a room is bookable, or that the timetable rules reflect verified institutional procedures. The board must prominently call itself **schedule-derived / prototype sample-data**, not sensor-confirmed real occupancy.

**M5 is accepted only if all hold:**
1. Pure deterministic venue-status logic produces the four specified states and next-free information, with boundary tests.
2. Status is computed from exactly the *unique currently PUBLISHED* version of the selected semester; never DRAFT/ARCHIVED or an arbitrarily supplied version ID.
3. Venue ACTIVE/INACTIVE/MAINTENANCE and `VenueUnavailable` are respected. A maintenance/unavailable venue is not silently labelled FREE.
4. Every role can view a sanitized current-status board as provided by the existing `VIEW_VENUE_STATUS` permission. Restricted roles cannot obtain someone else's timetable information by status-board requests; server controls access independent of hidden UI elements.
5. An authorized demonstrator can set an arbitrary weekday/time, switch back to live, and observe updated statuses without modifying persisted data or the operating-system clock. Live mode refreshes as time changes.
6. Null, missing, ambiguous, corrupt and stale published data do not produce deceptive FREE statuses or leak stack traces/SQL/secrets.
7. The route, navigation, mobile/desktop layout, keyboard interaction, time-zone labelling and understandable error/empty states work in a browser.
8. All targeted tests, `npm run verify`, `npm run build`, `git diff --check`, review and manual acceptance pass. Exactly identified evidence, files and commits are recorded.
9. No M4 behavior, tests, seeds, schema, dependencies or protected databases are altered without a separately justified and approved scope amendment.

## 2. In scope and explicitly out

**In:** one pure venue-status engine, time/interval boundary semantics, current-publication read-only snapshot, sanitized projections, strict clock input and authorization, `/venues/status` board, M5 menu activation, tests, demo walkthrough, progress and decisions.

**Out:** M6 lecturer rescheduling and issues, M7 QR attendance, extra reporting, physical occupancy sensors, creating bookings from this board, editing venue unavailability, role changes, changing M4 published views or constraint solver, university academic-year calendar integration, new dependencies, new database migrations, PostgreSQL/Docker (M9), payment/exam/LMS/native app features, unverified university policies.

## 3. Critical model distinctions

- `Venue.status` (`ACTIVE`, `INACTIVE`, `MAINTENANCE`) is a stored **operational** attribute.
- Display status (`OCCUPIED`, `UPCOMING`, `FREE`, `UNAVAILABLE`) is a **computed schedule state at a specified time**. Do not overwrite the stored attribute or reuse its type name.
- The prototype's time model is a **weekly repeating Mon–Fri timetable** with day strings and HH:MM, not date-specific room telemetry. There is no currently verified academic-year-to-semester mapping. Semester 1/2 selection must be explicit and the board must say what it is showing.
- A published class in a venue does not prove anyone is physically present. “FREE” means no applicable published booking or recorded closure at that evaluation time; it is not authorization to reserve the room.
- A valid empty publication (zero entries) is distinguishable from **no publication**; no publication must not be reported as FREE.
- The existing venue register `/venues` is an editable management surface guarded by `DECLARE_VENUE`. The new `/venues/status` is a **separate read-only surface** guarded by `VIEW_VENUE_STATUS`. Do not broaden the register's permissions.

## 4. Proposed deterministic status contract (M5 design decisions)

### 4.1 Input shape

An illustrative pure interface, subject to test-driven refinement:

```ts
type VenueClock = { day: 'MON'|'TUE'|'WED'|'THU'|'FRI'|'SAT'|'SUN'; time: string }; // strict HH:MM
// All supplied objects are plain data; no database, Date.now(), process.env, cookies, or network.
venueStatus(version, venue, now, policy): VenueStatusResult
```

`version` must contain the **trusted current published version ID** and *its* scheduled entries (venueId/day/start/end), not arbitrary untrusted browser data. `venue` includes id/code/stored operational status and its recorded unavailability windows. `policy` includes the upcoming window, default **30 minutes** per M5 in the repository spec, plus supported teaching days/time semantics. A centralized config owns the 30-minute setting; it must not be buried as a magic constant in UI/server queries. Explicit `now` is parsed and supplied by the caller; the function is pure and the same inputs yield the same output.

Avoid editing an existing `PolicyConfig` shape without first determining all current test fixtures and callsites affected. Record whether this is done through a safe extension of `DEFAULT_POLICY` or a dedicated typed M5 policy passed into the function.

### 4.2 Comparison and precedence (proposal to record in DECISIONS)

Represent all daily intervals as **half-open** `[start,end)` measured in minutes since local midnight. A class at 08:00–09:00 is occupied at 08:00 but not at 09:00. Reject `start >= end`; never sort invalid text times as if valid. No midnight-spanning intervals exist in the current schema/pilot; reject them instead of guessing.

At a trusted evaluation time, use this precedence:
1. Venue `INACTIVE` or `MAINTENANCE` -> `UNAVAILABLE` (indefinite until a recorded operational change).
2. Active venue with a matching `VenueUnavailable` time interval -> `UNAVAILABLE`.
3. Otherwise, a matching published entry -> `OCCUPIED`.
4. Otherwise, the *next* published entry beginning within **0 < delta <= 30 minutes**, provided an earlier recorded closure does not intervene -> `UPCOMING`.
5. Otherwise -> `FREE` (schedule-derived, not physically verified).

**Ties:** At exactly 30 minutes before a class, `UPCOMING`; at the class start, `OCCUPIED`; at the end, no longer occupied unless another interval starts immediately. An unavailable interval beginning at the same instant as a class takes visual priority as `UNAVAILABLE`; an officer-level integrity warning may expose the conflict count, but must not reveal private class metadata to other roles.

**“Next free” semantics:** For an ACTIVE venue currently `OCCUPIED` or within a time-bounded `UNAVAILABLE` period, `nextFreeAt` is the earliest HH:MM *after the union of all touching/overlapping current blocking intervals*. For `FREE` or `UPCOMING`, the room is already schedule-free and `nextFreeAt` may equal `now`; the UI should instead emphasize `nextScheduledAt` where known. For an `INACTIVE` or `MAINTENANCE` venue, `nextFreeAt = null` (“Not known until operational status changes”). Do **not** claim a free period has any minimum duration or is fit for a proposed class. If the next-free output falls outside supported teaching hours, say so or show it only as the end of the recorded block rather than a bookable slot. The returned time is a *day + HH:MM* when necessary, not an ambiguous bare clock string.

**Irregularities:** Two overlapping published bookings are never silently discarded. The status remains computed deterministically with a data-integrity signal to privileged roles; M5 does not mutate or revalidate the timetable into a different version. Unknown or malformed required venue status, missing venue, bad day/time, unavailability or entry interval, wrong version/semester or corrupt relevant data -> typed failure, not a reassuring FREE. A published venue without bookings is FREE if ACTIVE and not unavailable. Unsupported days (SAT/SUN) yield no scheduled Mon–Fri teaching from this weekly pilot, with a visible outside-assumed-hours caveat.

### 4.3 Suggested output

```ts
type ComputedVenueState = 'OCCUPIED'|'UPCOMING'|'FREE'|'UNAVAILABLE';
type StatusSuccess = {
  ok: true;
  venueId: string;
  status: ComputedVenueState;
  asOf: VenueClock;
  nextFreeAt: VenueClock | null;
  nextScheduledAt: VenueClock | null;
};
type StatusFailure = { ok: false; kind: 'INVALID_POLICY'|'INVALID_VENUE'|'INVALID_PUBLISHED_DATA'|'INVALID_CLOCK'; message: string };
```

The field choices are suggested, not an implemented API contract. Keep the **public response** minimal. Never include raw `TimetableEntry`, teaching IDs, student/group names, lecturer names, registration numbers, unavailability reason, audit fields, session data or credential-like values in a general venue-status response.

## 5. Server data and consistency contract

Create a separate typed **read-only** service and Prisma adapter; reuse established patterns from M4 (`publishedTimetableContract.ts`, `publishedTimetable.ts`, `publishedTimetableStorePrisma.ts`) but do not route the board through an M4 *venue timetable* perspective that a student cannot access.

Recommended flow:

1. Page calls its own server `requireAnyAction('VIEW_VENUE_STATUS')` guard, not just the root layout.
2. Read the **trusted actor** from the server; validate the exact request shape (semester, live/demo mode, day/time). Reject extra keys, arrays, forged role/actor, `versionId`, outside-range values, etc.
3. Independently authorize the clock mode (see §6). On denial return FORBIDDEN *before* reading any timetable data.
4. Use a single read-only Prisma transaction to resolve **zero, one or many** `PUBLISHED` versions for the chosen semester and, when unique, read **all current-version venue/time-only entries plus current venue attributes and unavailability windows in the same coherent snapshot**. Select only necessary fields. Do not import fields needed solely for a class-detail grid.
5. Require unique current publication, correct semester/status, non-null publication timestamp and valid linked records. Zero -> `NO_PUBLISHED_VERSION`; more than one -> `AMBIGUOUS_PUBLISHED_VERSION`; inconsistent data -> typed failure. Neither returns a fabricated board.
6. Compute one deterministic status per venue using the injected `now`/policy. Map to a **redacted**, code-sorted public board. No database writes, audit writes or seed changes.
7. Return current publication metadata, selected semester, effective clock mode/as-of, and status rows. A later publication can supersede the snapshot; do not promise permanent currency or untested simultaneous-writer guarantees. The next live refresh/re-navigation re-reads the current publication.
8. Catch unexpected store failures and return a fixed `INTERNAL_ERROR` without propagating SQL, DB paths, URLs, stack traces or stored exception text to client or logs.

**Required failure distinctions:** `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_INPUT`, `INVALID_CLOCK`, `NO_PUBLISHED_VERSION`, `AMBIGUOUS_PUBLISHED_VERSION`, `INVALID_PUBLISHED_DATA`, `INTERNAL_ERROR`; an explicit `STALE` result is necessary only if the implementation adds a separate resolution-before-snapshot stage. Keep false success distinct from zero rows.

**Mutation boundary:** this M5 service has *no* create/update/delete/upsert API. GET and demo controls cannot publish, reserve, change venue status, change the academic clock globally or persist a selected simulated date.

## 6. Role, privacy and demo-clock authority

The repository already grants `VIEW_VENUE_STATUS` to **all six roles**. The accepted M4 amendment separately restricts timetable detail views:

| Role | M5 live status board | Proposed arbitrary demo-clock access | M5 returned class/group/lecturer details |
|---|---|---|---|
| ADMIN | yes, read-only | yes | none |
| OFFICER | yes | yes | none; use existing authorized timetable page for detail |
| DEPT_REP | yes | no | none |
| APPROVER | yes | no | none |
| LECTURER | yes | no | none |
| STUDENT | yes | no | none |

**Design proposal to explicitly decide before code:** restrict arbitrary day/time “time travel” to OFFICER and ADMIN while giving other roles only live status. This meets the M5 demo requirement through the officer role, while reducing the risk of using an unrestricted clock to reconstruct other groups' schedules. Even this does not remove the information inherent in displaying a current venue status; university approval of what constitutes permissible occupancy metadata is still required. If project ownership chooses all-role demo-clock access instead, record that *explicit* policy decision and its privacy trade-off; do not infer it from `VIEW_VENUE_STATUS: ALL`.

The control is not a new *mutation* permission and must not grant officer/admin new schedule-write powers. Read results for all roles contain statuses, venue codes and generic timing only. A forged URL, client-side role flag or raw API request cannot elevate the actor. Do not share a general-purpose raw timetable dataset to a client component merely to make the simulated clock fast.

## 7. Clock and time-zone contract

- **Live:** resolve time from a server-injected clock; convert to the campus reference zone **Africa/Nairobi (EAT)**. This is a proposed explicit time-zone interpretation of Kisii's location, not evidence that university regulations approved a time policy. Show the zone in the UI. Never rely on unlabelled client-local date inputs or the deployment server's configured time zone.
- **Demo:** select a weekday (MON–SUN) and a strict 24-hour HH:MM. It changes only this authenticated board view. No global clock mutation, DB persistence or academic-year reassignment. Show a prominent “Simulated time — not live” indicator.
- **Semester:** choose 1 or 2 manually. There is no proven academic calendar mapping to determine the current semester from the wall date. The existing M4 default of semester 1 may be reused with a visible semester label, but cannot be claimed institutionally correct.
- **Live update:** the UI should initiate a fresh server read roughly each minute while in live mode and whenever the user returns/reloads after publication; no client-calculated statuses from a leaked schedule. In demo mode, status changes when the user applies a new day/time; the newly rendered result must match it exactly. Document actual refresh precision and do not call it sensor-realtime.
- **Untrusted search params (suggested):** `semester=1|2`, `mode=live|demo`, `day=MON..SUN`, `time=HH:MM`. `day`/`time` required *only* in demo mode and rejected in live mode; `mode=demo` denied for non-demonstrators; extra/duplicate keys fail closed. The server computes the effective clock and never accepts an arbitrary actor or publication reference from a URL.

## 8. Venue board UI and microcopy

**Route:** `/venues/status`; keep `/venues` (venue register) unchanged. Once accepted, set `venue-status` navigation `built:true` and update its existing menu tests.

**Page structure:**
1. Title: “Venue status” and always-visible existing prototype banner.
2. Explanation: “Calculated from the current published weekly timetable and recorded venue unavailability. Not a sensor reading or a booking guarantee.”
3. Semester selector, current published version indicator and as-of weekday/time/EAT. User can tell which publication and clock produced the result.
4. Officer/admin-only demo clock section: Live / Simulated, day selector and HH:MM time input, an explicit Apply action, and Reset to live. Clear state after actor changes; signed-out or restricted actors cannot preserve a forged simulated mode.
5. Four status categories as **text** plus optional non-exclusive styling. Every venue row: code, venue type if useful, status, next free/next scheduled as appropriate; no restricted teaching metadata. Sort deterministically by venue code.
6. Dedicated readable errors: no publication, multiple publications, invalid input, stale/current-version changed, invalid data, internal read error. For no publication, never show “All rooms free.”
7. Empty actual venue register is distinguished from empty published class list. Use “No venues registered” versus “No published timetable for semester N”.
8. Accessibility: form labels, grouped controls, keyboard focus, focus order, screen-reader live-status feedback without excessive announcements, no color-only meaning, mobile stacking, readable 200% zoom, no horizontal content clipping.

**Example safe messages:**
- “CR1 — Occupied (scheduled) until 09:00.”
- “LAB2 — Unavailable (recorded closure).”
- “GR1 — Upcoming class in 30 minutes; presently schedule-free.”
- “No published timetable exists for semester 2. The board cannot infer availability for that semester.”
- “Simulated Monday, 08:30 EAT; this does not change the published timetable.”

## 9. Test inventory with explicit evidence

Tests may be split to keep files cohesive. Use descriptive test names; example identifiers are a planning matrix, not claimed existing tests.

**Pure domain `venueStatus` (M5-T1):**
- D01 current class at exact start -> OCCUPIED.
- D02 one minute before end -> OCCUPIED; D03 exact end -> FREE (unless another booking begins).
- D04 exact 30 minutes before next class -> UPCOMING; D05 31 minutes before -> FREE.
- D06 two adjacent bookings -> still OCCUPIED at boundary; merged next-free time.
- D07 overlapping bookings -> deterministic, none discarded.
- D08 ACTIVE venue with no classes -> FREE; D09 a different venue's class never affects it.
- D10 venue operational INACTIVE -> UNAVAILABLE; D11 MAINTENANCE -> UNAVAILABLE; unknown status rejected.
- D12 active venue with matching recorded blackout -> UNAVAILABLE; D13 blackout start/end half-open boundary.
- D14 blackout overlaps published class -> unavailable precedence with integrity signal.
- D15 blackout ending exactly as class begins -> occupied (no fake availability gap).
- D16 nextFree for occupied through overlapping/adjoining blocking periods; D17 indefinite venue state has null next free.
- D18 UPCOMING next scheduled time and currently free; D19 day mismatch, weekend/outside-time caveats.
- D20 invalid clock HH:MM, invalid day, invalid window, start >= end, wrong venue/version, missing IDs -> typed failure, no dropped rows.
- D21 input permutation invariance, stable ordering, unchanged input objects, fixed inputs produce byte-identical results.
- D22 policy boundary / configurable upcoming window (not hard-coded).

**Server/service (M5-T2):**
- S01 no session -> UNAUTHENTICATED; **zero store reads**.
- S02 unsupported action/role -> FORBIDDEN with zero store reads.
- S03 extra and forged keys rejected; duplicate/malformed fields rejected before reads.
- S04 student/lecturer/department representative and approver live reads allowed, projected rows never contain class/teacher/group/entry metadata.
- S05 unauthorized demo clock request via forged URL denied before reads; officer and admin demo requests allowed.
- S06 no published version -> typed NO_PUBLISHED_VERSION, not FREE.
- S07 two published versions -> typed AMBIGUOUS_PUBLISHED_VERSION, no arbitrary selection.
- S08 only DRAFT/ARCHIVED exist -> NO_PUBLISHED_VERSION; no leakage of their sessions.
- S09 valid published version -> exact trusted version ID; correct semester; correct venue statuses.
- S10 publication changes between requests -> newer version on next request, never mixed old/new version rows.
- S11 malformed published/venue/unavailability record -> typed failure, no partial or falsely free board.
- S12 simulated clock changes do not invoke any mutation or change recorded timestamps/data.
- S13 unexpected DB error -> fixed INTERNAL_ERROR, no raw SQL, secrets, stack or path in response/log.
- S14 time-zone conversion from injected fixed instants, including midnight/weekday boundaries.

**Real disposable SQLite integration (M5-T2):**
- I01 stored ACTIVE/MAINTENANCE/INACTIVE venue rows and unavailability are read without amendment.
- I02 two semesters with different current publications; one DRAFT and one ARCHIVED intentionally contain contradictory sessions and are ignored.
- I03 a replacement publication changes the derived board on next read, while archived rows remain intact.
- I04 real read snapshot includes coherent version + entries + venues + unavailabilities; no synthetic grouping or borrowed version.
- I05 real DB unauthorized requester receives no raw entries; strict redacted projections by role; actor comes from trusted server context.
- I06 no DB mutation/attendance/audit/history changes across reads or demo time changes; compare stable snapshots/counts.
- I07 bogus/missing relationship and ambiguous version cases fail closed (as test fixtures allow) with exact typed outcomes.
- I08 isolated SQLite fixture directories are created and removed only by their own test cleanup; protected dev and walkthrough databases are never accessed.

**Page/interaction (M5-T2):**
- P01 signed-out `/venues/status` redirects to login.
- P02 six signed-in roles see sanitized statuses; role-specific menus show a working venue-status link when accepted.
- P03 only officer/admin see demo controls; forced `mode=demo` denied for restricted roles.
- P04 semester selector stays 1/2; invalid query does not silently reset to 1.
- P05 Monday 07:30 vs 07:29 vs 08:00 vs 09:00 produces expected displayed transition for a controlled published fixture.
- P06 simulated clock inputs are clearly labelled and do not change local/system/database time.
- P07 Reset to live discards demo time; live page refresh reads server-evaluated current time.
- P08 no publication / ambiguous / invalid data / server failure have actionable non-leaking errors; empty list distinct.
- P09 desktop (1440×900, 1280×800), phone (390×844, 375×667), 200% zoom, keyboard-only, screen reader label checks; do not count static rendering as a browser pass.
- P10 existing M4 published timetable, venue-register CRUD, draft generation/publication still work; no visual or authorization regression.

**Performance/reliability:** record dataset size, environment, duration for deterministic full-board renders; no invented SLA or fabricated measurements. Test live refresh intervals and that repeated refresh does not mutate data. Verify no unbounded polling, timers cleaned up on unmount and no periodic refresh in fixed demo mode.

## 10. Implementation plan — bounded, independently reviewable subtasks

The official tasks remain **M5-T1** and **M5-T2**. The a/b/c labels below are task slices to preserve the previously used one-task/one-review discipline. The file manifests are **planned ceilings**; inspect the actual diff before implementation and report deviations. All file limits include `PROGRESS.md`/`DECISIONS.md`. Never silently exceed a task's manifest.

| Subtask | Deliverable / acceptance gate | Proposed owned files (max) |
|---|---|---|
| **M5-T1a** | Lock the contract/semantics; verify baseline; record status precedence, privacy, next-free and clock policy decisions. **No runtime edits.** | `docs/M5-DESIGN.md`, `PROGRESS.md`, `DECISIONS.md` (3) |
| **M5-T1b** | Pure status engine and tests D01–D22 (or equivalent). Domain has no Prisma/Next/network/clock read. All four statuses, boundary and malformed cases covered. | `src/domain/venueStatus.ts`, `src/domain/__tests__/venueStatus.test.ts`, `src/domain/policy.ts` *only if necessary*, `PROGRESS.md`, `DECISIONS.md` (up to 5) |
| **M5-T2a** | Typed request/result/read-store contract and pure orchestration; strict actor/request checks and sanitized board projections; focused injected-store tests. No Prisma adapter yet. | `src/server/venueStatusContract.ts`, `src/server/venueStatus.ts`, `src/server/__tests__/venueStatus.test.ts`, `PROGRESS.md`, `DECISIONS.md` (5) |
| **M5-T2b** | Prisma adapter with one coherent read-only transaction and real isolated SQLite integration; tests I01–I08. No schema/seed or runtime DB changes. | `src/server/venueStatusStorePrisma.ts`, `src/server/__tests__/venueStatusStorePrisma.test.ts`, `PROGRESS.md`, `DECISIONS.md` (4) |
| **M5-T2c** | Authenticated server `/venues/status` with status board, clear publication errors, no clock controls yet. Page calls service; keep menu Coming soon until complete. | `src/app/venues/status/page.tsx`, `src/server/__tests__/venueStatusPage.test.tsx`, `PROGRESS.md`, `DECISIONS.md` (4) |
| **M5-T2d** | Live/simulated clock controls and server input validation; page updates on Apply and live refresh. Accessible form and tests. **No raw schedule pushed to browser.** | `src/app/venues/status/VenueStatusControls.tsx`, `src/app/venues/status/page.tsx`, `src/server/__tests__/venueStatusPage.test.tsx`, `PROGRESS.md`, `DECISIONS.md` (5) |
| **M5-T2e** | Final role-boundary/page regression sweep and flip `venue-status` menu flag to built; confirm direct route + forged URL handling. | `src/domain/menu.ts`, `src/domain/__tests__/menu.test.ts`, `src/server/__tests__/venueStatusPage.test.tsx`, `PROGRESS.md`, `DECISIONS.md` (5) |
| **M5-T2f** | Manual demo acceptance, protected-file preservation, complete verification, evidence reconciliation and M5 closure only after all gates pass. Documentation only; do **not** begin M6. | `docs/M5-DESIGN.md` (acceptance addendum), `PROGRESS.md`, `DECISIONS.md` (3) |

**Note about T1b and existing policy fixtures:** If adding a required policy field would affect more files than planned, avoid silent spillover. Either use a separately typed M5 policy/config without changing `PolicyConfig`, or propose a clearly documented, separately reviewed larger manifest. Do not weaken tests or make optional fields hide a real missing requirement. If adapter/service code cannot fit cohesive files, propose a file split within an explicitly expanded task rather than stripping logic.

**Dependencies:** `T1a -> T1b -> T2a -> T2b -> T2c -> T2d -> T2e -> T2f`. A slice is *not* approved just because the previous one has been coded: review acceptance and Git evidence first. Run against the same remote branch, avoiding parallel editors to shared files. Commits should use exact task identifiers, e.g. `M5-T1b: implement pure venue status logic`.

## 11. Mandatory agent procedure for every coding slice

1. `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git fetch`/check tracked remote as access permits. Must be on `m5-development`; reconcile remote/local changes without reset/force-push. Verify a clean tree or inventory pre-existing changes and protect them.
2. Read `AGENTS.md`, current `PROGRESS.md` ending, `DECISIONS.md` relevant sections, `PROTOTYPE_SPEC.md` M5 and the accepted M4-T4h policy. Confirm fixed file manifest and test plan.
3. Change only the authorized slice. No refactor/migration/dependency/seed change. No deletion of user files, arbitrary temp directories, `.env`, untracked files, or database files. `prisma/dev.db`, `prisma/walkthrough.db` and any existing journal companions are protected.
4. Test focused changes plus `npm run verify` (typecheck → lint → all Vitest → seed check), `npm run build`, `git diff --check`. Keep test output and exact counts. M4 previously used `RUST_LOG=info` to work around a Prisma environment issue; apply **only if actually required** and disclose it rather than changing app code. No fake passes.
5. For code that uses real SQLite, create a unique *disposable* temporary fixture DB and compare the protected before/after hashes if those files exist; do not run `seed`, `migrate`, `db push`, `db reset` or a browser server against user-owned DBs just for verification.
6. Run browser/manual cases where relevant; document precisely who ran them, viewport and observed result. Static React and database tests do not substitute for browser observations.
7. Append (never rewrite earlier entries) `PROGRESS.md` and `DECISIONS.md`; preserve the repository's established line endings and history. Record accepted decisions, incomplete results, deviations and next task boundary.
8. Commit *only* the tested slice with separate task commit. Never force-push, merge, publish a new timetable as an unintended side effect, change default branch or start M6. If the GitHub connection denies writes, report the actual response and provide a patch/handoff without claiming a remote commit.
9. Final report: task ID, summary, exact changed-file manifest, each acceptance item with proof/failure, targeted/full test output, build result, browser attribution, git status and commit SHA, protected DB hash status, blockers, next authorized slice. One task per session.
10. The `AGENTS.md` ambiguity and three-repeated-errors stop rules still apply to the coding agent. Proposed new choices belong in `DECISIONS.md`, not invented `ASSUMPTION-n` tags; A1–A18 in `PROTOTYPE_SPEC.md` retain their existing meanings.

## 12. Ten-minute demonstration sequence for M5 (after M4)

1. Sign in as **OFFICER**; show existing M4 current published semester 1 timetable. If the sample DB has only the seeded conflicted draft, demonstrate publication **on a disposable seeded copy** through the existing valid M4 workflow first. Never call the conflicted DRAFT 'published'.
2. Open `/venues/status`. Point out version, semester, status origin and prototype/sample-data banner. Show all nine sample venues by code, including shared GR1/GR2, if the disposable fixture still contains them.
3. In Simulated mode select a time exactly 30 minutes before a published booking. Show UPCOMING; then apply the booking start -> OCCUPIED; then apply its end -> FREE, provided there is no adjoining booking. Explain half-open boundaries.
4. Select `WED 09:00` for seeded `LAB2` blackout (08:00–12:00) or `FRI 15:00` for `LH1` blackout (14:00–17:00), provided seeded unavailability is retained; show UNAVAILABLE, and explain indefinite operational maintenance vs time-bounded closures.
5. Show a venue with no upcoming class as FREE, explicitly *scheduled-free*, not confirmed empty/available for ad hoc booking.
6. Switch to semester 2 without a published version (if that is the fixture state); confirm the page correctly says no publication instead of marking all rooms free.
7. Switch to student/lecturer/department persona using real signed-in demo accounts; board still shows sanitized current statuses, has no raw timetable detail, and attempted `mode=demo` URL escalation is denied. Return to officer; Reset to live works.
8. Ask timetabling staff which room availability rules, exceptions, calendar semantics and visibility policies differ in actual university operations; capture the feedback outside M5 code and do not present an unverified answer as fact.

The exact class/venue/time fixture for steps 3–5 must be confirmed against the **actually published disposable test version**. A planted conflict in the original DRAFT is not a valid booking demonstration.

## 13. Closure gates and report

**Gate A — source & Git:** correct branch/head, clean working tree, all committed task slices, no unintended merge, stable protected files.

**Gate B — correctness:** pure D01–D22 equivalence, typed data errors, published-only/semester-only scope, unavailability, next-free boundaries, deterministic ordering.

**Gate C — security/privacy:** six role cases, impersonation and forged URL denials, no raw event/identity data from generalized status response, no timetable detail-leak through selectors, no writes.

**Gate D — integration:** real SQLite fixture snapshot, current-publication replacement, no-publish/ambiguous states, no mutation, test cleanup and no protected DB access.

**Gate E — UX:** labelled as schedule-derived, both live/demo modes, direct route and menu, mobile/desktop/keyboard/200% zoom, correct errors and simulated/live indicator.

**Gate F — automated:** focused tests, full `npm run verify`, `npm run build`, `git diff --check`, Git status; exact output and commit evidence.

**Gate G — manual:** independent demonstration browser record and operator attribution. User browser acceptance, if supplied, is recorded as *user-reported* and not claimed as an agent-run test.

**Gate H — close:** append outcome and limitations to PROGRESS/DECISIONS. Only declare M5 ACCEPTED/CLOSED after all mandatory gates are evidenced. Do not begin M6 without separate authorization. If browser access or a fixture is unavailable, mark acceptance PENDING, list remaining checks, and preserve a runnable branch.

**Retained limitations to state after success:** not physical presence; not a reservation guarantee; weekly synthetic data with unverified institutional calendar; no approved-submission generator gating; no guarantee against publication immediately after a read snapshot; no tested distributed locking, production load, privacy audit or operational rollout.

## 14. Reusable task and review prompts

### One-slice implementer prompt

> Work only on branch `m5-development`, on the authorized subtask `<M5-ID>` defined in `docs/M5-DESIGN.md`. Read `AGENTS.md`, the end of `PROGRESS.md`, `DECISIONS.md` relevant M4/M5 sections, and `PROTOTYPE_SPEC.md` M5. Verify branch, SHA, clean tree and protected DBs. First state the exact allowed file manifest (including PROGRESS/DECISIONS) and acceptance checks, then implement **only this slice**. Do not add dependencies, edit schema/seed, broaden existing M4 access, expose unscoped timetable details, touch protected databases, merge, force-push or start the next slice. Follow pure-domain, strict-input, trusted-session, read-only snapshot, typed-failure and least-privilege contracts. Run targeted tests, `npm run verify`, `npm run build`, `git diff --check`; do browser checks when relevant. Preserve and append progress/decisions, commit only the verified slice, and return exact evidence, changed files, commit SHA/status, browser attribution, open blockers and remaining acceptance. If scope expands, stop and report the necessary expansion rather than silently changing extra files.

### Independent strict reviewer prompt

> Review `<M5-ID>` strictly, **without edits**, against the approved M5 design, `AGENTS.md`, M4-T4h accepted security contract and the exact commit/diff. Check correctness (all four statuses, time boundaries, next-free semantics, published-only semester/version), role/clock authorization, minimized output, snapshot consistency, stable error cases, protected DBs and no accidental mutation. Name each unmet criterion with file/line and a concrete failing scenario; distinguish executed evidence from narrative claims, and state ACCEPT / CHANGES REQUIRED / UNVERIFIED. Do not begin another task.

### Final M5 review prompt

> Audit M5 end-to-end on `m5-development` against Gates A–H, independent of the implementation agent's own PASS claims. Verify all M5 commits, scoped diffs, current published read, real SQLite integration, auth and unauthorized clock URL handling, live/demo UI, exact automated command output, and manual desktop/mobile/keyboard/zoom results. Identify remaining blockers and whether acceptance is evidenced. Do not modify code or merge. Recommend closure only when all required checks pass.

---

**Design provenance:** repository files and past TAMS task-review conventions; proposed implementation policy is identified as proposed and not represented as verified university procedure. **No GitHub code or branch was changed to produce this design.**

## Implementation authorization — 8 November 2026
The user explicitly requested implementation of the attached M5 plan in separate
local commits, automated verification and an apply-ready ZIP. This authorizes
progress through the listed slices in this session, with local review/checks
between commits. It supersedes the one-slice-per-session default for this bundle.
File ceilings remain as listed. Manual browser work is delegated to the user;
M5 closure must remain pending until that evidence is supplied. No M6 work.

The proposed deterministic and privacy decisions in sections 4–7 are adopted for
this prototype: half-open blocking intervals, operational/unavailability priority,
union-based next-free, configurable 30-minute upcoming window, strict request
shape, all-role sanitized live status, OFFICER/ADMIN-only simulated time,
Africa/Nairobi reference clock, explicit semester, read-only snapshot. These are
prototype design decisions, not validated university policy. A dedicated typed
M5 policy reuses DEFAULT_POLICY teaching days/hours without altering PolicyConfig.
All roles receive generic same-day timing only; integrity counts are privileged.

## M5-T2f implementation and automated acceptance record — 8 November 2026

**Current status: IMPLEMENTED LOCALLY; AUTOMATED CHECKS PASS; MANUAL ACCEPTANCE
PENDING. M5 IS NOT ACCEPTED/CLOSED. No M6 code has been started.** This supersedes
the original design-only status for this implementation delivery. GitHub remains
unchanged by this task; apply-ready commits are delivered in a ZIP.

### Implemented contract
- `src/domain/venueStatus.ts` owns a dedicated M5 policy and pure validated engine.
  Recorded interval union, operational precedence, half-open boundaries and
  configurable upcoming window implement section 4. Same-day timing always carries
  day and HH:MM; no next-day booking is inferred. Weekends and end-of-block times
  outside assumed hours are visibly qualified.
- The server service accepts only string query fields: semester 1/2 (default 1),
  mode live/demo, and day/time only for demo. Duplicate arrays and extra keys fail
  closed. Current publication is selected solely from the trusted read snapshot.
- All six roles may read live statuses. OFFICER/ADMIN alone can choose arbitrary
  simulated times and see generic integrity counts. No identity, class details,
  teaching/group references, closure reasons or raw entries reach the controls.
- One Prisma read transaction resolves the unique current publication and reads
  venue/closure fields plus current entry times. Parameterized LEFT joins expose
  missing teaching/unit links as null for typed failure instead of dropping rows.
  Relevant entries must link to registered venues and the selected unit semester.
  The store has one read method and no writes, including no audit writes.
- `/venues/status` guards itself, uses dynamic server reads, displays explicit
  publication/semester/clock and safe errors, and has labelled GET forms. The live
  control requests a fresh server render every 60 seconds while visible and on
  visibility return; timer/listener cleanup and demo-no-polling are tested with a
  mocked environment. Status calculation never runs over client-supplied schedules.
- `venue-status` alone is newly built in navigation. Existing venue-register,
  timetable detail and scheduling mutation permissions are unchanged.

### Evidence and limits
- Domain: 54 focused tests; request/service: 56; real disposable SQLite: 22;
  page/control integration: 40; menu: 26 total (six new role cases).
- Final code verification: `RUST_LOG=info npm run verify` passes 1531 tests across
  60 files, typecheck, lint and seed integrity 11/11. Production build passes.
  Full actual per-slice and final output is delivered under `evidence/` in the ZIP.
- Initial verify without the override failed in inherited SQLite fixture setup;
  the existing documented Prisma/RUST_LOG issue was reproduced. Subsequent checks
  use `RUST_LOG=info`; application/schema/dependencies are not changed to mask it.
- Dev startup passes with explicit `--hostname 127.0.0.1`; without hostname this
  sandbox denies OS network-interface enumeration. A real unauthenticated HTTP
  GET to `/venues/status` returns 307 with Location `/login`. This is a server
  smoke check, not a browser test. Its server was stopped before final build.
- Integration output records actual full-board durations for nine synthetic
  venues and one current entry; no production load/SLA or simultaneous-writer
  guarantee is asserted. Publication replacement is sequentially verified.
- Exact remote base `078fd71dfe10dd3e22a5da58ea15613299a5dc7f` was reconstructed
  through GitHub read access because direct cloning was unavailable. All 179 blob
  hashes, source tree `e32dbb1ebbe820d1fd0f6e6dcdca4a5c73cd0d19` and base commit
  hash match remote. The original parent is outside this shallow checkout.
- The ZIP includes separate-commit metadata, exact manifests, full output,
  review/acceptance matrix, VS Code application instructions, manual checklist,
  and an independent fresh-base patch-application/tree-comparison transcript.
  This transcript is packaging evidence, not university/browser acceptance.
- Protected prisma/dev.db, walkthrough.db and their journal/WAL/SHM companions
  were absent before and after this task, never opened or created. Historical
  hashes in M4 records are not claimed for this fresh checkout. Existing `.env`,
  seed meaning, migrations, schema and dependency files are unchanged.
- Cleanup removes only newly created integration mkdtemp directories and the
  task-created dependency directory when reusing matching installed dependencies.
  No tracked source or pre-existing user file/directory was deleted.

### Closure handoff
Gates B/C/D/F have automated evidence within the described prototype scope.
Gate A is local-only with no remote update. Gate E has static structure and timer
checks; desktop/mobile CSS, keyboard and zoom require user observations. Gate G
is pending user manual verification; therefore Gate H remains OPEN. Follow the
ZIP's MANUAL-CHECKLIST.md and record observations before accepting/closing M5.
Retained limitations in section 13 still apply: schedule-derived weekly synthetic
data, no physical occupancy or reservation guarantee, unverified institution
policies/calendar/privacy, and no production/deployment/concurrency certification.

## M5-T2g user-reported manual acceptance and milestone closure — 8 November 2026

**Current status: M5 ACCEPTED AND CLOSED for the approved prototype scope.** This
supersedes the pending handoff in T2f while preserving that historical record.
The user explicitly reported on 8 November 2026: "I have done all the live
browser manual test successfully." This records successful completion of the
requested live manual acceptance as user-reported evidence for Gates E and G.

No browser/version, viewport, fixture identifier, individual checklist results or
additional observations were supplied with the report. They are not inferred, and
this acceptance is not described as an agent-run browser test. The earlier domain,
service, real SQLite, page/control, menu, full verification, build, HTTP and Git
checks remain the automated evidence for Gates A–F; T2g adds a fresh verification
before its documentation-only commit. Gate H is closed by this dated record.

The user separately authorized the M5 acceptance commit/push, a local merge into
master, and creation/publication of `m6-change-handling`. No M6 implementation is
included in this closure. All retained limitations in section 13 still apply:
status is schedule-derived weekly synthetic data, not physical occupancy or a
reservation guarantee; institutional calendar/privacy/workflow assumptions remain
unvalidated; and no production load, distributed-locking, deployment or privacy
certification is claimed.
