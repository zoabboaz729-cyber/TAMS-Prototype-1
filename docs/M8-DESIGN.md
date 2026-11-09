# M8 frozen design reference

The following is the supplied final v1.1 blueprint. Its historical “implementation not started” statements describe design handoff, not current status. The owner subsequently authorized implementation and expressly waived the five-file cap for M8. Current behavior, evidence and remaining owner acceptance are in M8-IMPLEMENTATION.md and M8-VERIFICATION.md.

# TAMS Prototype 1 — M8 Full Design and Implementation Blueprint

**Version:** v1.1 FINAL — presenter-entered feedback mode selected by owner; implementation-ready design handoff (no source changes authorized or performed by this document alone)  
**Prepared:** 9 November 2026 (Africa/Nairobi)  
**Repository:** https://github.com/zoabboaz729-cyber/TAMS-Prototype-1  
**Target branch:** `m8-meeting-tools-polish`  
**Inspected target HEAD:** `a41cb7d6071c3e6c10cbd6008d2725add9b168c9`  
**Comparison:** target HEAD == `master`; one commit ahead of `m7-qr-attendance` (its M7 acceptance/merge handoff).  
**Status:** DESIGN FINALIZED; M8 IMPLEMENTATION NOT STARTED. The owner selected **A: presenter-entered feedback** on 9 November 2026. No M8 files changed in the repository and no M8 verification commands were executed during design. The target branch HEAD and default `master` were rechecked; M8 remains at `a41cb7d6071c3e6c10cbd6008d2725add9b168c9`.

## 0. Finalized owner choice and executive design decision

**Owner decision (LOCKED, 9 November 2026):** **A — Presenter-entered feedback**. The project presenter operates `/assumptions` while discussing A1–A18 with university participants. Feedback is written by the authenticated TAMS demonstration `OFFICER` or `ADMIN` account. Participants need **no accounts**, do **not** submit records directly and have **no** anonymous/guest/public write endpoint. The presenter may identify the participant's **role** using an optional controlled field, or choose "Not specified"; do not require or invent personal names or official authorization. The logged-in account reflects the **demo operator's access role**, **not** the university participant's identity/authority.

This finalizes the **interaction model**, not the content of university policies. The remaining decisions in this document are explicit, conservative **designer defaults**, to be implemented as stated unless verified code makes a specific technical contract impossible. No new owner policy choice is needed to start M8 design-approved work; execution still follows the normal Git/change-control workflow and an explicit implementation instruction. Anything learned at the university meeting remains a finding until independently validated.


**M8 is a transition from engineering-feature completion to stakeholder discovery.** The meeting is not intended to prove that the project's assumptions are institutional facts. It is intended to give authorized university timetabling stakeholders a coherent, evidence-based prototype to react to, and to record their correction of assumptions without losing those findings. M8 must be **meeting-safe, not just UI-polished**.

The authoritative requested scope is `PROTOTYPE_SPEC.md` §§9, 11 (M8-T1/T2), 12, and 13:

1. **M8-T1** — `/assumptions` lists A1–A18, permits **Confirm / Reject / Modify** plus an explanatory note, persists outcomes, and exports findings as CSV.
2. **M8-T2** — a ten-minute interactive **demo script page**, consistent important empty/error states, and an explicitly controlled **seed reset**. A complete end-to-end demo must run from fresh synthetic seed state.

M8 is **not** a new generator, PostgreSQL migration, attendance anti-fraud redesign, GPS feature, native mobile app, or institutional-policy certification. M9/PostgreSQL remains after meeting feedback, as specified. M7's distinct **Start class** and **Open attendance** controls remain distinct. The M5 display clock must never be used as an M7 attendance security clock. No new package is recommended.

The owner has confirmed **only the presenter-entered feedback approach**. The remaining previously proposed behavior is fixed below as **implementation-design defaults**, not described as separately owner-approved institutional policy. The implementer should follow these defaults without requesting unnecessary preference clarifications, while stopping on the concrete safety/technical blockers in §12.2. Nothing here is university-approved practice.

## 1. Evidence-first repository baseline

### 1.1 Directly inspected facts [VERIFIED BY REPOSITORY READING]

| Evidence | Exact observed fact | M8 consequence |
|---|---|---|
| `PROTOTYPE_SPEC.md` | M8 is two tasks; A1–A18 exist in §9 and the 10-minute script in §12 | Build those contracts first; no invention of A19–A20 |
| `AGENTS.md` | One bounded task/commit, max 5 changed files unless explicitly waived, `npm run verify`, no unapproved dependencies, no destructive file operations, mandatory task report | The previous M7 file-count waiver **does not carry over** to M8 |
| `prisma/schema.prisma` | `AssumptionFeedback` already exists with `id`, `assumptionKey`, `verdict`, `note`, `at`; indexes on key/verdict | Prefer an additive implementation; do not duplicate the model or rewrite earlier migrations |
| `prisma/seed.ts` | The CLI seed performs destructive deleteMany across tables, including `assumptionFeedback`, and creates a planted-clash DRAFT | Blindly calling the CLI seed from a browser would destroy meeting findings; do **not** do it |
| `src/domain/seedData.ts` | Deterministic synthetic fixture; S1 planted DRAFT has two known clashes; no clean published timetable created by seed | Demo guide must include valid draft repair/generation and publication before venue/attendance steps |
| `src/domain/permissions.ts` | Explicit deny-by-default permission matrix; no M8 feedback/demo/reset actions yet | Add explicit actions, guards and denial tests; menus are not a boundary |
| `src/domain/menu.ts`, `src/app/page.tsx` | Role-filtered menu is already the navigation system; generator menu item is still `built:false` while generation lives inside `/officer/draft` | Link the real generation workflow, not a placeholder `/officer/generate` |
| `src/server/guards.ts`, `src/server/origin.ts` | Existing sign-in, per-route authorization, same-origin POST patterns | Reuse these; reject direct forged requests, not only hide buttons |
| `src/server/demoMode.ts`, `src/components/DemoSwitcher.tsx` | Demo mode is **exactly** `DEMO_MODE=true` and nonproduction; switcher only exposes synthetic demo accounts | Reuse same gating logic but make destructive reset require a second, explicit safety gate |
| `src/app/venues/status/page.tsx` | Venue status uses a schedule-derived, optionally simulated view; it is not sensor-confirmed occupancy | Demo text must say what is and is not being shown |
| `src/app/lecturer/attendance/page.tsx`, `src/app/student/scan/page.tsx` | Lecturer class reporting and QR controls are separated; scan confirmation is server-based | Demonstrate independent actions; do not infer attendance/presence from class-start or QR |
| `docs/M7-VERIFICATION.md`, `docs/M7-MANUAL-ACCEPTANCE.md`, `PROGRESS.md` | M7 accepted by owner on 9 Nov 2026; former implementation reported 1,760 tests/77 files, 11 seed checks, and build, plus owner-reported browser acceptance | Use as historical baseline, **not** as new M8 verification evidence |

The M7 acceptance has **limitations**: its semester 1 period is synthetic; semester 2 dated attendance is not fully configured; device binding is a STUB; and QR scanning is not physical-presence proof. `M7_SYNTHETIC_DEMO` uses a separately configured **server** clock offset, not the M5 URL/view clock. Do not conceal these limitations on the demo page.

### 1.2 Design confidence labels

- **VERIFIED** — read in the remote repository or its published verification records.
- **PROPOSED** — a recommendation made for M8; not yet implemented or accepted.
- **NEEDS UNIVERSITY VALIDATION** — local timetable/attendance practice that should be discussed at the meeting, not assumed.
- **BLOCKED** — a condition that must stop an unsafe or untruthful operation.
- **PENDING ACCEPTANCE** — implemented and verified by an executor but not yet accepted by the owner (future stage only).

No fresh clone, `npm run verify`, browser walkthrough or code mutation was performed for this **design**. The implementer must recheck the branch commit hash before starting.

## 2. Product goals and hard invariants

### 2.1 Measurable M8 success

**G1:** All 18 canonical assumption keys and their exact meanings are visible, clearly marked as **unvalidated**, with a meaningful place to collect a verdict and notes. No key is silently missing, renamed or invented.

**G2:** An authorized presenter can record multiple dated findings about any assumption. A later correction does not overwrite the earlier finding. At least one full historical CSV export can be opened in common spreadsheet software without column corruption or formula execution.

**G3:** Captured meeting findings survive **the application's normal demo-reset button**. Reset is impossible in production, without an authenticated privileged presenter, without same-origin validation, or against non-allowlisted database URLs. Reset does not execute arbitrary shell commands and cannot target an arbitrary path from HTTP input.

**G4:** The on-screen demo guide is demonstrably aligned to the actual M0–M7 screens, role switches, state dependencies and time sources. It does not promise that a fresh seed already contains a published, attendance-ready session.

**G5:** Core routes distinguish *empty*, *not yet prepared*, *invalid input*, *forbidden*, *offline/unknown*, and *server/database failure*. They give truthful actions rather than false success or bogus zero counts.

**G6:** M0–M7 regressions remain green; all new changes have tests and acceptance evidence; no real university records are introduced.

### 2.2 Non-negotiable invariants

**I01** Canonical assumption set is exactly A1–A18, mapped to the corresponding `ASSUMPTION-1`…`ASSUMPTION-18` registry items from the specification. A prose change after institutional feedback is a reviewed requirement change, not a silent editing of the historical assumed wording.

**I02** Feedback capture is explicitly labelled **stakeholder comment/claim**, not automatically institutionally approved policy. Even a `CONFIRM` row is a recorded response, not proof of university-wide authorization.

**I03** All feedback writes and all access to feedback history/CSV are authenticated, authorized **server-side**, and origin-checked. Unknown roles/actions default to deny.

**I04** Every feedback event persists atomically with an audit event (where the existing AuditLog is used); no false UI confirmation if the transaction rolls back. Historical feedback is append-only; no edit/delete endpoint is introduced in M8.

**I05** A1–A18 notes are bounded, validated and safely rendered; no raw HTML injection; CSV values cannot become spreadsheet formulas. Raw database errors are not surfaced to users.

**I06** No real participant names, student registration IDs, phone numbers or unreleased institutional data are required in notes. Prefer stakeholder **role** over person-identifying information.

**I07** A reset affects only an explicitly selected disposable **synthetic** demo database, never an implicitly selected `dev.db`, `walkthrough.db`, production DB, user working copy, or any other unspecified file.

**I08** Reset preserves meeting feedback by default. The UI must make preservation conspicuous and cannot offer a one-click "delete all findings" action. If a separate **CLI** seed can erase findings, that hazard must be detected and explicitly guarded/documented.

**I09** Reset is POST-only, confirm-before-submit, admin-only, demo-enabled-only, and double-gated by a dedicated reset setting and database allowlist. No remote/public deployment of reset is authorized.

**I10** Reset cannot generate a published timetable by pretending the original planted conflicts were never present; fresh seed retains the same synthetic examples and their meaning.

**I11** No demo time passed via query string may validate live QR tokens or modify M7 server-side clock logic. The clock and semester limitations remain visible.

**I12** Venue reservation ≠ verified occupancy; lecturer Start class ≠ Open attendance; Open attendance ≠ physical presence; stored attendance ≠ official attendance rate.

**I13** For all M8 tasks: tests, lint and typecheck must never be weakened; only actual executed checks count as verification; browser/manual acceptance stays separately attributed to the owner.

**I14** `AGENTS.md`, `PROTOTYPE_SPEC.md`, existing M6/M7 acceptance records and protected databases are untouched unless a separate, expressly authorized change requires them. Avoid new dependencies.

## 3. The 18 assumptions — canonical catalog contract

The following meanings are from `PROTOTYPE_SPEC.md` §9; the UI must preserve their key/semantic content, even if it formats them for reading:

| Key | Canonical assumption | Meeting prompt (designer guidance, not alleged fact) |
|---|---|---|
| A1 | Timetables are shared via WhatsApp | How are official timetables issued, changed and distributed? |
| A2 | Each department has a timetabling representative | Who prepares/submits needs; is there an official nominated role? |
| A3 | One whole-year timetable with two semesters | Is planning per semester, academic year, school or some other cycle? |
| A4 | Departments own rooms; unclaimed rooms are shared | Who controls allocation, ownership, temporary lending and shared facilities? |
| A5 | Clashes mostly follow lecturer reschedules | Which clash types are frequent, and who approves changes? |
| A6 | Attendance is on paper registers | Which programs use registers, portals or other mechanisms? |
| A7 | Computing runs a GPS attendance pilot | What system exists, what is the accuracy experience, and who maintains it? |
| A8 | Semester dates are August–December and January–April | What are authoritative term calendars and exception rules? |
| A9 | Scheduling slot grid and teaching days | Which periods, intervals, breaks, weekends and exceptions are valid? |
| A10 | Lecturer/group workload limits | Are limits mandatory, recommended, or department-specific? |
| A11 | Capacity must meet expected enrollment, no overbooking | Are exceptions possible; who approves them and what facilities matter? |
| A12 | HoD approves departmental submissions | Is this the real approval chain, including returns and delegations? |
| A13 | Registrar/officer publishes timetables | Who has final authority to approve and publish? |
| A14 | Students have smartphones | What approved attendance alternatives are needed? |
| A15 | Every unit has 3 contact hours/week, split 2+1 | What determines contact hours and lecture/lab splits? |
| A16 | SOEN 321 Professional Attachment is not timetabled | How are attachments, fieldwork and placement activities represented? |
| A17 | Pilot class is Year 4 | Confirm class/cohort labeling and authoritative pilot group data |
| A18 | Computer-based units need a lab once per week | What determines lab frequency, venue type and specialist equipment? |

**Implementation requirements:** store this as a readonly typed table in `src/domain/assumptions.ts`; validate unique keys, exact count and order using tests; do not attempt to parse Markdown specs dynamically at runtime. The prompt column is a **recommended interview aid** and should be labelled as such, never persisted as a purported answer.

### 3.1 Feedback interaction

**[OWNER-SELECTED MODE: PRESENTER-ENTERED]** The presenter signs in using an existing local **demo** `OFFICER` or `ADMIN` account, discusses each assumption, and enters what participants say. Participants need **no application accounts** and **cannot** use an unauthenticated/guest or public writable form. Render the exact disclosure: "Feedback entered by the prototype presenter, reflecting a stakeholder statement. Not an official university approval." Sign-in is required for capture/history/export. All signed-in roles may read canonical assumption wording, but *only* the two presenter roles may read captured feedback/history/export. The speaker's university role is an optional, explicitly selected descriptor; it must not be derived from the logged-in OFFICER/ADMIN demo account.

**Concrete interaction sequence:** present the assumption's unchanged A-key/text; optionally select a speaker role (including `NOT_SPECIFIED`); choose `CONFIRM`/`REJECT`/`MODIFY`; enter the required explanation for Reject/Modify; submit with a one-time idempotency key; show confirmation only after server persistence; refresh latest status/history. A later correction is a *new event* rather than an edit. If network confirmation is uncertain, re-read history before attempting to record again. No meeting-participant self-service, approvals workflow or public guest UI is introduced in M8.

Recommended fields for an event:

- `assumptionKey` (exactly one of A1–A18, no arbitrary strings).
- `verdict` (`CONFIRM`, `REJECT`, `MODIFY`; absence is `NOT_REVIEWED` in the UI but never a stored fake verdict).
- `note` (text, trim, max 2,000 characters; mandatory nonblank for REJECT and MODIFY, optional for CONFIRM; no unnecessary personal details or claims of formal sign-off).
- `meetingLabel` (optional free-text *facilitator-created* session label, max 120 characters, e.g. `Timetabling office discovery 1`; not an official event ID. Never automatically attribute responses to a named attendee).
- `sourceRole` (optional role of the **person giving the answer**, not the authenticated demo presenter; use the explicit values `NOT_SPECIFIED`, `TIMETABLING_STAFF`, `REGISTRAR_OR_ACADEMIC_ADMIN`, `DEPARTMENT_REP`, `HEAD_OF_DEPARTMENT`, `LECTURER`, `STUDENT`, `OTHER`. Default `NOT_SPECIFIED`; do not infer a person's identity, formal authority or approval).
- `recordedByRole` (server-sourced snapshot of the **TAMS demo operator account's role**, either `OFFICER` or `ADMIN`; label it "Recorded using demo account role", **not** "Stakeholder role" or "Official approver").
- `at` (DB/server timestamp, not from browser).
- `submissionKey` (one-time idempotency key for double-click/network retries; not a QR/token; never in public exports unless needed for reconciliation).

**Schema compatibility:** the existing `AssumptionFeedback` model already supports the key/verdict/note/time. The extra provenance/idempotency fields are a **recommended additive nullable migration**, not a replacement of previous rows. Retain old rows with null provenance; display them as "not recorded". Do not add a foreign-key reference to a user that would make preserved findings undeletable/reject a safe demo reset. `AuditLog` may separately capture the presenter user ID at event creation, but its retention differs from the preserved feedback row and must be documented. See owner decision at end.

The main page displays each assumption with its **latest recorded stakeholder response** and a chronological expandable history, not an overwriteable scalar. The current verdict is computed from the latest event by `(at DESC, id DESC)`, so equal timestamps have deterministic ordering. The page shows count of reviewed assumptions out of 18, total feedback events, and a clear warning that these are **captured opinions**, not certified institutional rules. An assumption with no events shows **Not reviewed**, not Reject.

### 3.2 Persistence and concurrency contract

- Validate key, verdict, note, meeting label, source role and idempotency key server-side with Zod; duplicate, malformed, unknown and oversized requests must never create a row.
- `OFFICER`/`ADMIN` capture only (recommended). Recheck in every mutation; do not rely on menu state.
- Save feedback plus an `AuditLog` action such as `ASSUMPTION_FEEDBACK_CAPTURED` in one Prisma transaction. The audit row records `actorId` from the authenticated session and feedback row ID as entity ID.
- Retrying the same submission ID returns its existing persisted result and **does not** produce a second event or audit row. Two distinct submissions remain two historical events, even for the same key.
- If no DB write succeeded, display a failure/unknown result with recovery instructions; never a saved checkmark.
- Do not perform a read-then-insert without a DB uniqueness backstop on the idempotency key. Add nullable `submissionKey String? @unique` on `AssumptionFeedback` so existing rows remain valid; the new UI always submits a server-validated nonempty key. Test concurrent duplicates against isolated real SQLite. A matching retry must be confirmed to refer to the **same stored payload**, otherwise return an explicit conflict rather than reuse a mismatched receipt.
- Use restrained input sizes and explicit server error mapping. Avoid storing raw session cookies, passwords, QR tokens or unneeded personal data in notes or logs.

### 3.3 CSV contract

**Recommended single export:** a **full chronological event register**, one row per persisted submission, including earlier corrected verdicts; this is preferable to a latest-only snapshot, which would hide how stakeholder understanding changed. Columns in this exact order:

`feedback_id,assumption_key,assumption_text,verdict,note,meeting_label,source_role,recorded_by_role,recorded_at_utc,is_latest_for_key`

- Encoding: UTF-8, `text/csv; charset=utf-8`, RFC 4180 escaping, CRLF rows; a UTF-8 BOM may be used if Excel compatibility tests justify it.
- Date is ISO 8601 UTC; sort by `(at ASC, id ASC)`; ensure `is_latest_for_key` is deterministically computed. If none exists, return **a header-only CSV** and show "No findings recorded yet" in the UI.
- Neutralize spreadsheet-formula injection at **all** untrusted text fields, including values beginning with `=`, `+`, `-`, `@` or leading whitespace/control characters before those. Quote CSV correctly for commas, quotation marks and newlines. Do not rely on HTML escaping for CSV protection.
- Export is an authenticated GET using a server role guard and `no-store`/private caching headers. No raw user-entered filter/filename/path can control the filesystem. Filename can be a deterministic safe date-based string: `tams-assumption-findings-YYYY-MM-DD.csv`.
- Access-denied and database-failure responses must not return a misleading empty CSV. Use 401/403/503 where appropriate, with no private contents leaked.
- For demo/school settings, do not call the file an "official approved requirements register" until stakeholders actually validate it.

## 4. Role, route and trust-boundary contract

### 4.1 Finalized permissions for presenter-entered M8 (designer defaults)

Extend `src/domain/permissions.ts` and `PERMISSION_SCOPE` with explicit deny-by-default cells for **every role**. Recommended actions:

| Action | ADMIN | OFFICER | DEPT_REP | APPROVER | LECTURER | STUDENT |
|---|---:|---:|---:|---:|---:|---:|
| `VIEW_ASSUMPTIONS` (catalog only) | ALL | ALL | ALL | ALL | ALL | ALL |
| `CAPTURE_ASSUMPTION_FEEDBACK` | ALL | ALL | NONE | NONE | NONE | NONE |
| `VIEW_ASSUMPTION_FINDINGS` | ALL | ALL | NONE | NONE | NONE | NONE |
| `EXPORT_ASSUMPTION_FINDINGS` | ALL | ALL | NONE | NONE | NONE | NONE |
| `VIEW_DEMO_GUIDE` | ALL | ALL | NONE | NONE | NONE | NONE |
| `RESET_DEMO_DATA` | ALL | NONE | NONE | NONE | NONE | NONE |

These are **prototype presenter permissions**, not university-authorized roles. A project presenter can operate the feedback workflow using the seeded `OFFICER` identity, and may switch to `ADMIN` for reset. University participants have no system identity or ability to submit records. `ADMIN`-only reset is deliberate separation of duties: a presenter using `OFFICER` cannot accidentally destroy a demonstration fixture. Never treat a hidden menu as a server authorization check.

Proposed routes:

| URL | Method | Purpose | Guard |
|---|---|---|---|
| `/assumptions` | GET | Static A1–A18 catalog; privileged role sees current findings and capture forms | `VIEW_ASSUMPTIONS`; separate `VIEW_ASSUMPTION_FINDINGS` before DB feedback read |
| `/api/assumptions/capture` | POST | Append one validated presenter-entered event | `CAPTURE_ASSUMPTION_FEEDBACK` + strict same-origin + Zod + authenticated demo actor |
| `/api/assumptions/export` | GET | CSV download, no arbitrary filters | `EXPORT_ASSUMPTION_FINDINGS` + `Cache-Control: private, no-store` |
| `/demo` | GET | Script, readiness, reset form for admin | `VIEW_DEMO_GUIDE` |
| `/api/demo/reset` | POST | Local-only guarded reset | `RESET_DEMO_DATA` + demo gate + dedicated DB allowlist + explicit confirmation + same origin |

**Chosen capture mechanism (no implementation ambiguity):** use `POST /api/assumptions/capture` as a Next.js Route Handler, calling the existing `isSameOriginRequest` helper, then `getCurrentUser`/server-side `CAPTURE_ASSUMPTION_FEEDBACK` authorization; validate payload with Zod; call the transactional service; return a minimal typed success/error response with `Cache-Control: private, no-store`. Use the `FeedbackForm` client to submit to this route, and only after a successful server response show a receipt and call `router.refresh()` to re-read history. The client must not send an authoritative `actorId`/`recordedByRole`. Missing or forged origins, signed-out users and nonpresenter roles fail before any write. No server action or alternative guest endpoint is in scope. Every private read is independently guarded; never trust `layout.tsx`.

### 4.2 Page design and accessibility

`/assumptions` is **presenter-operated**: the university attendees see it on the shared demo screen, without submitting from their own devices. It should have: a prototype warning; reviewed count; 18 stable sections labelled `A1`–`A18`; one-sentence assumption, an optional discussion prompt, latest recorded verdict or **Not reviewed**, a visible history of dated revisions for authorized presenters; form controls with programmatic labels, radio verdict options, note textarea and save feedback status; export button for authorized roles; no uncontrolled HTML interpolation. Keyboard and small-screen behavior must be tested.

Successful saving should say e.g. **"Recorded feedback for A12. This is a stakeholder statement awaiting institutional validation."** An invalid form names the field and the action to take. A database error must say **"Feedback was not confirmed saved; check your findings history before retrying."** These are not interchangeable.

Do not show the internal meeting feedback history to a role with only `VIEW_ASSUMPTIONS`. Public/catalog users must not infer who recorded opinions from hidden JSON props or server responses.

## 5. Demo script and readiness design (M8-T2)

### 5.1 Two honest operating modes

**Guided live walkthrough (primary):** start with a **dedicated disposable synthetic** fixture seeded with the original records, sign in and switch the **presenter's demo account** by role, demonstrate submissions, inspect planted conflicts, create and publish a valid draft, view schedules/rooms, then perform separately configured attendance demonstration. At discussion points, the presenter switches back to `OFFICER`/`ADMIN` to record participants' responses on `/assumptions` (or records them at the end); no participant logs in. This is the spec's ten-minute path, with actual prerequisites shown. Do not pretend one user can hold two demo roles simultaneously.

**Prepared dry run (optional facilitator preparation):** presenter runs the same walkthrough on a **different disposable fixture** ahead of the meeting to verify timing, QR camera, HTTPS/localhost and role switches. Do not add a hidden "skip validations and publish instantly" endpoint, fabricated counts, or a second unofficial timetable.

### 5.2 Verified route-adapted 10-minute guide

The `/demo` page should render **sequenced links, role, expected state, question, and failure recovery** for each step:

| Minute | Presenter role | Screen/action | What the audience should see | Ask |
|---|---|---|---|---|
| 0–1 | OFFICER | `/assumptions` | A1–A18 shown as unvalidated, feedback capture visible | Which assumptions are wrong or incomplete? |
| 1–3 | DEPT_REP then APPROVER | `/department/submission` → `/department/review` | Real DRAFT→SUBMITTED→APPROVED workflow and scoped role switching | Who supplies and authorizes inputs? |
| 3–4 | OFFICER | `/venues` | Owned versus centrally shared venues, capacities | Who owns/assigns these rooms? |
| 4–6 | OFFICER | `/officer/draft` | Planted clash detected; change one entry, then generate a validated clean candidate; publication only when checks pass | How are conflicts resolved and schedules approved? |
| 6–8 | OFFICER, then another viewing role | `/officer/draft` publish → `/timetable` (and date view if relevant) | Published version and role-scoped authoritative timetable | How are publication/change notifications handled today? |
| 8–9 | OFFICER | `/venues/status` | Schedule-derived free/upcoming/occupied; demo time clearly labeled | Does this match the actual concept of venue occupancy? |
| 9–10 | LECTURER then STUDENT | `/lecturer/attendance` → `/student/scan` → `/reports/attendance` | **Separate** Start class / Open attendance; QR or typed code; server-confirmed mark; duplicate rejection | Which attendance controls would be acceptable? |

Ten minutes is an **illustrative script**, not a performance measurement; role switching, generation and QR camera permissions can make it longer. Do not claim this timing has been achieved until rehearsed. Put a **follow-up questions / findings** box on every guide step pointing to A1–A18; the facilitator records answers using the authenticated `/assumptions` capture path (switching back to OFFICER if necessary), never a second transient/untracked note state. A response attributed to a university stakeholder must never be labelled "entered directly by participant".

**M7 setup reality:** M7 attendance's synthetic clock is **server-side**, controlled by `M7_SYNTHETIC_DEMO=true` and `M7_DEMO_OFFSET_MINUTES`; it only operates in the supported demo conditions and for the configured synthetic term. The M5 URL-selected simulation does **not** open an M7 QR window. A fresh seed has **no published timetable** and still contains two planted draft clashes. `termFor(2)` remains unconfigured in the observed historical M6/M7 design. Present these prerequisites rather than bypassing them.

### 5.3 Readiness panel

Add a small, **read-only** readiness service called from `/demo`, guarded by presenter permission, which reports explicit statuses with bounded safe explanations:

| Check | Ready when | Not-ready message |
|---|---|---|
| Synthetic mode | `DEMO_MODE=true`, nonproduction and correct seeded sample accounts | Demo account switch unavailable; use configured local fixture |
| Database | Connection succeeds, expected synthetic entities and seeded accounts exist | Data unavailable or not seeded; stop, do not display empty as success |
| Department submission | Appropriate submission state exists for this walkthrough phase | Submit/approve the sample department requirements |
| Draft / conflicts | A viewable draft exists; at first it is **intentionally conflicted** | No draft or data; prepare via existing editor |
| Published timetable | Exactly one current valid PUBLISHED version in selected semester | Publish a conflict-free candidate first |
| Venue views | Approved publication and suitable venue data | Check published version and venue register |
| QR demonstration | Correct synthetic clock configuration, effective published occurrence, lecturer/student demo accounts, server secret | Not ready: configure synthetic attendance and matching scheduled lesson; M5 demo time cannot substitute |
| Findings CSV | Valid feedback table and capture access | Feedback storage/export unavailable; do not proceed assuming notes will be saved |
| Reset permission | ADMIN with explicit extra gate and safe DB | Reset disabled, as intended, outside a disposable fixture |

Do not present all checks as globally **READY** immediately after seed: the draft/publish sequence is intentionally part of the presentation. The panel may say **"Ready for first step; later steps require setup"**. No new dependency or internet service is required.

## 6. Safe demo-reset specification

### 6.1 Threat model

A browser reset is effectively a destructive database operation. Existing `prisma/seed.ts` clears `AssumptionFeedback`; running it through an HTTP button would potentially destroy the university's meeting findings and all M7 history. A stale browser session or a forged request could also cause unintended loss. The **UI and the server** must both enforce a separate reset policy.

**Proposed reset policy:**

1. Only visible/callable by a logged-in **synthetic demo** `ADMIN` account; officers may see reset **readiness/status** but cannot invoke it. On completion, the presenter may switch back to `OFFICER` to continue capture.
2. `DEMO_MODE === "true"`, `NODE_ENV !== "production"`, **and** `M8_DEMO_RESET_ENABLED === "true"`. Every gate fails closed, returning 404/403 without touching Prisma mutations as appropriate.
3. Accept only a **dedicated, explicit, allowlisted SQLite demo URL** (e.g. `DATABASE_URL=file:./m8-demo-meeting-01.db`, Prisma-relative) that exactly matches a **second** server-only setting `M8_DEMO_RESET_DATABASE_URL=file:./m8-demo-meeting-01.db`. Resolve the actual SQLite file path canonically under the project's `prisma/` directory in the **server** (the pure domain gate validates only input strings/flags); reject `dev.db`, `walkthrough.db`, unset or mismatched URLs, unexpected schemes, outside paths, symlink escapes and ambiguous resolution. `M8_DEMO_RESET_ENABLED` defaults to false. No HTTP `dbPath` parameter and no unguarded reset via CLI. Add these commented, safe-off settings to `.env.example` in T2c.
4. POST-only, same-origin, requires typed exact confirmation `RESET SAMPLE DATA`. Show precise effect before the button. No GET deletion and no direct shell invocation of `npm run seed`, `rm`, `prisma migrate reset`, or arbitrary child process.
5. Preserve **every** `AssumptionFeedback` row including key, verdict, note, provenance and timestamps across the normal button reset; preserve their associated `ASSUMPTION_FEEDBACK_CAPTURED` audit records too. Keep deterministic seeded user identities unchanged so retained audit foreign keys remain valid. If audit preservation is impossible, **fail reset before writes** rather than erase the record while claiming it survives. Other operational audit events can be pruned only as documented for the dedicated synthetic fixture.
6. Restore original deterministic **synthetic operational** data: original A1–A18 definitions, sample actors/departments/groups, initial DRAFT with planted conflicts, venues, availability and submissions. Newly generated timetable, M6 changes, attendance sessions/records, issue modifications and class reports are removed only in the allowlisted fixture.
7. Perform reset in a single database transaction, with strict M7 attendance attempts/activity/records/sessions → M6 exceptions/requests → timetable/version dependency order, followed by operational fixtures. Retain fixed seeded demo user IDs and any account needed by preserved feedback audit; reconcile known seed records in place instead of deleting all users. Delete only *known* operational demo records; refuse if unknown users, external references or unexpected relational state make safe reconciliation unprovable. Keep all preservation/restore operations inside one atomic transaction and validate its concrete SQLite behavior. A raw `npm run seed` invocation from the browser is forbidden.
8. Make output idempotent at the **logical fixture** level: a second reset yields identical operational seed records and no extra duplicate records (except an explicitly audited reset event, if chosen).
9. On completion, invalidate or refresh stale UI/session state; redirect to the beginning of the demo guide and announce which parts were cleared and that **findings were retained**. If transaction fails, show failure and leave prior state intact.
10. Record actual before/after counts and all intentionally deleted record categories in the implementer's task report. Never reset a protected local database during development or automated tests.

**CLI seed safety (fixed implementation default):** retain the existing deterministic CLI seed behavior only for an isolated database with **zero** findings. Before any destructive `deleteMany`, `npm run seed` must check `AssumptionFeedback.count()` and **refuse with an explicit explanation when it is nonzero**, with no data changed. The presenter uses the dedicated guarded browser reset to restore operational demo data while preserving findings. Do not introduce an unguarded override flag or a silent “wipe findings” mode. A separately authorized destructive full reset remains outside M8.

### 6.2 Expected reset test examples

- With `M8_DEMO_RESET_ENABLED` absent: GET/POST fails closed and no row changes.
- With `NODE_ENV=production`: fails closed regardless of other flags.
- With an OFFICER, STUDENT, or anonymous actor: fails closed.
- With forged Origin/Host/Sec-Fetch-Site, bad confirmation, or nonallowlisted DB: fails closed.
- With real feedback already stored: after two resets, all rows/notes/timestamps remain and the original conflicting seed draft returns.
- After one reset, previously published versions, M6 one-offs, M7 attendance, reports and issue mutations no longer appear; default seeded rows do appear.
- Inject a DB failure mid-reset: no partial wipe, no false success.
- With unexpected non-demo user/foreign reference: refuse safely; never guess whether deletion is acceptable.
- Re-run normal seed in an **isolated no-feedback test fixture** twice: original deterministic counts remain stable.

## 7. Error and empty-state design

Adopt one small shared accessible component, e.g. `src/components/FlowStatus.tsx`, with explicit variants `EMPTY`, `NOT_READY`, `INVALID`, `ERROR`, `UNKNOWN`. A component should accept a safe reason and action link; it must not infer server success or swallow errors. Preserve existing specialized error content; only unify areas where genuine inconsistency exists.

Priority: `/assumptions`, `/demo`, `/officer/draft`, `/department/submission`, `/department/review`, `/timetable`, `/venues/status`, `/lecturer/attendance`, `/student/scan`, `/reports/attendance`. Ship in bounded slices; no mass refactor, visual redesign or changes to accepted business logic.

| Situation | State | Example user-facing recovery |
|---|---|---|
| No feedback for assumption | EMPTY | "Not reviewed. Choose a verdict after the stakeholder discussion." |
| No draft/published version after seed | NOT_READY | "A published timetable does not exist yet. Resolve/generate a valid draft and publish it." |
| No venue matches filters | EMPTY | "No venues match the selected filters. Clear filters." |
| Lecturer has no effective occurrence today | EMPTY | "No assigned effective published classes for this date. Check term/date and published schedule." |
| QR clock mismatch or missing term configuration | NOT_READY | "No eligible current synthetic attendance session. Check the configured server demo clock and published occurrence." |
| Scan request not confirmed due to network failure | UNKNOWN | "Attendance not confirmed. Check history before retrying." |
| DB query fails | ERROR | "Data unavailable; retry or ask the demo operator to check the database." **Never** show fabricated zero or hide error as EMPTY |
| Form data invalid or conflict detected | INVALID | Name the exact correction and retain authorized form inputs |
| Unauthorized access | FORBIDDEN | Use existing guard and deny response; no protected data leaked |
| Reset refused by safety gate | BLOCKED | "Demo reset is disabled or this is not the dedicated demo database." |

Check keyboard focus, labels, alert/status semantics, long text wrapping, zoom/phone width and screen-reader announced success/errors. The demo banner "Prototype — sample data. Not official university records." must remain visible globally.

## 8. Granular M8 execution plan — **strict five-file limit per slice**

**Task ID discipline:** M8-T1 and M8-T2 are parent requirements. The sub-IDs below are design-defined *implementation slices*. Each is a separately reviewable commit. Unless the owner explicitly waives the M8 limit, no more than five **actual changed tracked files per slice**, counting `PROGRESS.md`, migrations and documentation. If extra code/test changes are genuinely needed, STOP, report and propose a new bounded slice; do not silently exceed the ceiling. The exact files below are the initial manifests; re-confirm immediately before each slice if remote HEAD has moved. Files within the same existing path can be revised by later slices, but never delete unrelated work. `DECISIONS.md` updates must be added inside the stated ceiling or in the dedicated final documentation slice.

### M8-T1 — assumptions, evidence capture, export

| Slice / commit title | Proposed exact file manifest (max 5) | Required acceptance gate |
|---|---|---|
| **T1a Canonical assumption registry** | `src/domain/assumptions.ts`; `src/domain/__tests__/assumptions.test.ts`; `PROGRESS.md`; `DECISIONS.md` **(4)** | Exactly keys A1–A18, stable order/text, unknown key denied, no A19; prompts distinguish source text from interview aids |
| **T1b Additive finding provenance/idempotency migration** | `prisma/schema.prisma`; `prisma/migrations/<new_m8_timestamp>/migration.sql`; `src/server/__tests__/m8FeedbackMigration.test.ts`; `PROGRESS.md`; `DECISIONS.md` **(5)** | Upgrade empty/current M7 DB without losing rows; old feedback nullable; uniqueness and FK checks pass |
| **T1c Explicit M8 permission actions** | `src/domain/permissions.ts`; `src/domain/__tests__/permissions.test.ts`; `PROGRESS.md` **(3)** | Complete deny-by-default matrix for six roles and six new actions; no navigation links to missing pages |
| **T1d Transactional feedback service** | `src/server/assumptionFeedback.ts`; `src/server/__tests__/assumptionFeedback.test.ts`; `PROGRESS.md` **(3)** | Input validation, append-only history, audit, idempotency, rollback and concurrent duplicates tested with disposable SQLite |
| **T1e Presenter page + explicit capture POST route** | `src/app/assumptions/page.tsx`; `src/app/api/assumptions/capture/route.ts`; `src/app/assumptions/FeedbackForm.tsx`; `PROGRESS.md` **(4)** | Logged-in OFFICER/ADMIN presenter capture only; speaker role optional; exact same-origin guarded POST; successful server receipt only; no feedback data in unprivileged response |
| **T1f Page/route security verification** | `src/server/__tests__/m8FeedbackActions.test.ts`; `src/server/__tests__/m8AssumptionsPage.test.tsx`; `PROGRESS.md` **(3)** | Presenter identity from server, source role optional and untrusted, forged actor/role/key/verdict/cross-origin rejected; private reads; note bounds; 18 rendered rows |
| **T1g Pure safe CSV encoder** | `src/domain/assumptionCsv.ts`; `src/domain/__tests__/assumptionCsv.test.ts`; `PROGRESS.md` **(3)** | All events, stable columns/time, CRLF, multiline/quote handling, formula neutralization, header-only no-data case |
| **T1h Authenticated CSV endpoint** | `src/app/api/assumptions/export/route.ts`; `src/server/__tests__/m8AssumptionsExport.test.ts`; `PROGRESS.md` **(3)** | Authorized download with no-store/private headers; 401/403/error not a fake CSV; no private data leakage |
| **T1i Activate assumptions navigation; stage demo entry** | `src/domain/menu.ts`; `src/domain/__tests__/menu.test.ts`; `PROGRESS.md` **(3)** | `/assumptions` becomes a clickable built link after T1h exists; `/demo` may be registered only as **not built** until T2a; all role menu tests pass |

**Checkpoint after T1i:** the presenter can conduct an assumption review and leave with a **durable CSV of captured findings**, even if T2 is postponed. This must be complete before enabling any reset. No menu should link to an unimplemented route.

### M8-T2 — guided demo, safe reset, polish and handoff

| Slice / commit title | Proposed exact file manifest (max 5) | Required acceptance gate |
|---|---|---|
| **T2a Canonical script and page** | `src/domain/demoScript.ts`; `src/domain/__tests__/demoScript.test.ts`; `src/app/demo/page.tsx`; `PROGRESS.md`; `DECISIONS.md` **(5)** | All seven script stages; real paths; no misleading `/officer/generate`; role/action/question/recovery visible; `/demo` guarded independently |
| **T2a-nav Activate guide navigation after page exists** | `src/domain/menu.ts`; `src/domain/__tests__/menu.test.ts`; `PROGRESS.md` **(3)** | `/demo` flips `built:true` only now, and only for OFFICER/ADMIN; previous M0–M7 menus stay unchanged |
| **T2b Honest readiness checks** | `src/server/demoReadiness.ts`; `src/server/__tests__/demoReadiness.test.ts`; `src/app/demo/page.tsx`; `PROGRESS.md` **(4)** | Fresh seed says *not yet published*, QR clock explicitly separate, no secret leak, no silent DB failure |
| **T2c Pure destructive-action gate + configuration** | `src/domain/demoResetPolicy.ts`; `src/domain/__tests__/demoResetPolicy.test.ts`; `.env.example`; `PROGRESS.md`; `DECISIONS.md` **(5)** | Strict demo flags, production deny, explicit reset DB target, exact confirmation; pure gate denies invalid config, while server later verifies canonical path/symlink against actual DB before writes |
| **T2d Guard CLI seed against feedback loss** | `prisma/seed.ts`; `src/server/__tests__/m8CliSeedGuard.test.ts`; `PROGRESS.md` **(3)** | No-feedback seed remains deterministic; existing findings cause explicit stop **before** deletion |
| **T2e Build transactional operational reset** | `src/server/demoReset.ts`; `src/server/__tests__/demoReset.test.ts`; `PROGRESS.md` **(3)** | Resets only known synthetic operational state; preserves findings; rollback & concurrency safety; respects M6/M7 FK order |
| **T2f Controlled POST reset and guide UI** | `src/app/api/demo/reset/route.ts`; `src/app/demo/ResetDemoForm.tsx`; `src/app/demo/page.tsx`; `src/server/__tests__/m8ResetRoute.test.ts`; `PROGRESS.md` **(5)** | ADMIN-only POST; same-origin, typed confirmation, gate; success re-read/redirect; all denials commit zero writes |
| **T2g Shared explicit status rendering** | `src/components/FlowStatus.tsx`; `src/app/assumptions/page.tsx`; `src/app/demo/page.tsx`; `PROGRESS.md` **(4)** | Distinct EMPTY/NOT_READY/ERROR/UNKNOWN and accessible feedback, no false success |
| **T2h Core scheduling/attendance polish** | `src/app/officer/draft/page.tsx`; `src/app/lecturer/attendance/page.tsx`; `src/app/student/scan/page.tsx`; `src/server/__tests__/m8FlowStates.test.ts`; `PROGRESS.md` **(5)** | Honest prep/empty/errors; Start/Open independence unchanged; no change to security clock or publication rules |
| **T2i Cross-role views/report polish** | `src/app/reports/attendance/page.tsx`; `src/app/venues/status/page.tsx`; `src/app/department/submission/page.tsx`; `src/server/__tests__/m8PageStates.test.ts`; `PROGRESS.md` **(5)** | Date/semester and no-data distinctions; simulated versus live facts and counts remain truthful |
| **T2j Lifecycle and human walkthrough checklist** | `src/server/__tests__/m8EndToEnd.test.ts`; `docs/M8-MANUAL-ACCEPTANCE.md`; `docs/M8-IMPLEMENTATION.md`; `PROGRESS.md`; `DECISIONS.md` **(5)** | Fully seeded-to-published-to-QR-to-feedback-to-export-to-reset path; negative authorization; written device checks |
| **T2k Documentation and final automated handoff** | `docs/M8-DESIGN.md`; `docs/M8-VERIFICATION.md`; `docs/M8-verification.txt`; `PROGRESS.md` **(4)** | Exact build/tree, real outputs, known limitations, per-task commits, no fabricated browser tests, apply-ready instructions |

The implementer may split a problematic slice into additional smaller commits **before coding**, with an explicit updated file manifest and acceptance gate, without changing the locked presenter-entered design or exceeding five changed files in any slice. Never merge all tasks into an unreviewable single change. Conversely, do not inflate the number of commits solely to satisfy a template when the repo's actual interfaces justify a slightly different grouping; request owner approval for deviations.

### 8.1 Dependency graph

```text
M7 accepted and merged -> M8 target HEAD audited
                        -> T1a catalog -> T1b migration -> T1c permissions
                        -> T1d service -> T1e UI -> T1f security tests
                        -> T1g CSV encoder -> T1h guarded export -> T1i catalog menu
                        -> T2a script -> T2a-nav guide menu -> T2b readiness
                        -> T2c reset gate -> T2d CLI protection -> T2e reset service -> T2f reset UI
                        -> T2g/T2h/T2i focused UX polish
                        -> T2j integration and owner manual checklist
                        -> T2k verification, ZIP/apply handoff, owner acceptance
```

**Critical path:** CSV export and feedback persistence must be complete **before** enabling UI reset. Every step in the designer's route map must point to an actual implemented screen at the target HEAD.

## 9. Verification matrix (minimum coverage, not results)

| ID | Scenario | Expected outcome |
|---|---|---|
| A01 | Catalog count/order and source text | Exactly A1–A18; no duplicate/missing keys; correct source meanings |
| A02 | Unreviewed assumption | `NOT_REVIEWED`; no invented verdict or misleading status |
| A03 | Confirm with optional note | One persisted feedback event and audit |
| A04 | Reject/Modify without nonempty explanation | Validation error; zero writes |
| A05 | Unknown key, malformed verdict, overlong note/meeting label | Denied; zero writes |
| A06 | Two distinct verdicts for one key | Both preserved; latest shown deterministically |
| A07 | Same submission key repeated / concurrent | One logical event and audit, no duplicates |
| A08 | Failing feedback transaction | Neither event nor audit commits; UI does not claim saved |
| A09 | Signed-out, student, lecturer capture/export | Denied without feedback/history leak |
| A10 | Forged source role/recorder role | Server-sourced recorder identity, restricted source role choices |
| C01 | CSV no rows | Header only, not a DB error |
| C02 | CSV corrected finding | All events included, latest flag correct |
| C03 | Comma, quote, CRLF, Unicode | Parse back to exact intended cells |
| C04 | Leading `=`, `+`, `-`, `@`, whitespace/control formula triggers | Safe spreadsheet text, never executable formula |
| C05 | Export DB failure or unauthorized actor | Explicit failure status; no misleading empty file |
| D01 | Fresh original synthetic seed | Seed DRAFT and planted conflicts present; no false publication readiness |
| D02 | Follow actual guide links | All paths exist; required roles/switches correct |
| D03 | Generate/publish proper draft | Existing M3/M4 validator gates still hold |
| D04 | M5 demo clock versus M7 server clock | Simulated venue time cannot validate attendance; distinct labels |
| D05 | Start class then Open attendance (and reverse on independent fixtures) | Separate actions; no automatic coupling |
| D06 | Valid scan / duplicate / expired / wrong group | Stored confirmation only for valid authorized scan |
| D07 | Meeting notes survive operational reset | Feedback rows, notes and timestamps identical before/after |
| R01 | Missing reset flag, production, wrong DB path | Reset disabled before writing |
| R02 | Wrong role, GET, forged origin, wrong confirmation | No changes |
| R03 | Reset twice | Stable original operational seed counts; feedback preserved |
| R04 | Failure during reset | Transaction rolled back; no half-seeded database |
| R05 | Unexpected user/non-demo record | Fail safely rather than erasing someone else's data |
| R06 | CLI `npm run seed` after feedback exists | Explicit refusal before deleting meeting findings |
| U01 | Empty/invalid/error/offline views | Correct states and recoveries, never false success |
| U02 | Keyboard/phone/screen-reader basics | Labeled controls, visible focus, wrapped notes and clear status messages |
| X01 | Existing M0–M7 unit tests and guards | All remain passing; no weakening/skipping |
| X02 | Clean/fresh M8 DB migration | Actual migration and seed tests pass; FK checks pass |
| X03 | Whole walkthrough from *named disposable database* | Documented steps/evidence; no protected database changed |

Run `npm run verify` after **every** slice, plus `npm run build` and `npx prisma validate` on applicable slices and at final handoff; exercise migration on *new disposable* and *pre-M8 clone* fixture. Preserve raw command output, exit code, date, commit SHA, environment/fixture label and test totals. Negative tests must check **zero writes**, not just status codes.

## 10. Mandatory owner-performed manual acceptance

The executor's automated tests do not replace the owner's browser/device walkthrough. `docs/M8-MANUAL-ACCEPTANCE.md` should record **PASS / FAIL / BLOCKED** with a referenced build and named disposable DB for:

1. Show exactly 18 assumptions on laptop and phone; explain they are proposals, not university rules.
2. As an authenticated `OFFICER` or `ADMIN` **presenter**, capture A1 CONFIRM, A4 MODIFY with explanation, A4 REJECT with a second explanation; select a controlled optional speaker role and check it is not confused with the logged-in actor. Verify both A4 events are visible and the newest is labelled correctly.
3. Switch the presenter's demo session to `STUDENT`, `LECTURER`, `DEPT_REP` and `APPROVER` (or exercise those roles using automated route tests); their access to captured responses/history/export must be denied, even though they can view assumption wording. Do **not** create university participant accounts.
4. Export CSV while signed in as the **presenter**; open in Excel or another spreadsheet reader; check Unicode/commas/line breaks and that formula-looking notes are **text**, not executed formulas. Confirm the export records the **demo operator's role** separately from the optional university speaker role.
5. Follow the complete M0–M7 demo from seeded DRAFT to published schedule, venue board, separate lecturer activity and attendance, accepted student scan, rejected duplicate, and scoped report.
6. Set M5's demonstration clock, show it does **not** shift QR token validity; use independently configured synthetic M7 server time in the supported semester.
7. Reset as demo ADMIN on a dedicated disposable DB; verify A1/A4 findings still exist and export identically; operational data and planted clashes have returned. Repeat once.
8. Try reset as OFFICER and with reset flag off; verify nothing changes. Do **not** try it on a protected database simply to prove rejection — use an isolated fixture or mocked policy test for that case.
9. Confirm representative empty/error/offline states, narrow layout, keyboard focus and the global prototype banner.
10. Record participant feedback and the institutional questions that are still unanswered, without asserting that a staff member officially approved a rule unless there is actual authorization/evidence.

Sample record fields: test date; app commit SHA; machine/device/browser; database **non-sensitive fixture label**; demo flags (not secrets); tester; scenario; PASS/FAIL/BLOCKED; observation; defect link; retest result. The owner may approve collectively, but the report must attribute it as **owner-reported**, not agent-observed.

## 11. Delivery, change control and Git handoff

- Work only on `m8-meeting-tools-polish`; preserve master until M8 acceptance and authorized merge.
- Each bounded slice gets a separate commit (`M8-T1a: ...`) and its own `npm run verify` result. Update `PROGRESS.md` with truthful task status and any approved decisions in `DECISIONS.md`.
- Do not silently expand M8 into M9/PostgreSQL, new integrations, or real student/lecturer data. No package upgrades without an explicit proposal (name, version, purpose, alternative).
- Preserve original M7 source and accepted tests, seed example meaning, M6 publication provenance and historical M7 records except in a **dedicated synthetic reset fixture**.
- If GitHub writes are denied (historically reported as HTTP 403), provide a local patch-apply ZIP: separate numbered `git format-patch` files, clean replay against the exact verified target commit, verification logs, per-file manifest, migration safety note, and Windows PowerShell/VS Code apply instructions (`git am --keep-cr` after confirming clean status and base). Never claim remote is changed if it was not.
- Handoff documents: `docs/M8-DESIGN.md`, `docs/M8-IMPLEMENTATION.md`, `docs/M8-VERIFICATION.md`, `docs/M8-MANUAL-ACCEPTANCE.md`, and raw verification output; optional `README-VSCODE.md` and SHA256 manifest in ZIP.
- Final implementation report template: **Summary · Actual files/commits · Verification executed/results · Acceptance matrix with proof · Manual scenarios for owner · Open risks/questions · Git state/handoff**. No full source-code dump is required if the reviewer can inspect exact commits.
- Do not label M8 complete until automated gates pass and owner acceptance is reported. Do not merge into master automatically merely because a build passes.

## 12. Final decisions and genuinely blocking conditions

### 12.1 Locked design decisions and conservative implementation defaults

The owner selected **A: presenter-entered**. All remaining choices are settled by the following **designer implementation defaults**: they are not a claim of university approval or a request to the owner to make additional design selections.

| Issue | Final contract | Decision origin |
|---|---|---|
| Feedback entry mode | Presenter types participants' responses while discussing A1–A18; no participant account, guest form or public write | **OWNER CONFIRMED (A)** |
| Who can capture findings | Signed-in TAMS demo OFFICER or ADMIN; actual logged-in actor sourced on server | Designer default, locked for M8 |
| Participant attribution | Optional controlled `sourceRole` selected by presenter; no name required, no guessed institutional approval | Designer default, locked for M8 |
| Read access | Every authenticated role may read A1–A18 text; only OFFICER/ADMIN may read private events and export CSV | Designer default, locked for M8 |
| Mutation transport | Same-origin, authenticated `POST /api/assumptions/capture` route with Zod and a transactional service, not a server action or guest endpoint | Designer default, locked for M8 |
| Provenance/schema | Add nullable `meetingLabel`, `sourceRole`, `recordedByRole`, unique nullable `submissionKey` to existing `AssumptionFeedback`; old records remain intact | Designer default, locked for M8 |
| Conflicting submissions | Idempotency unique key; matching retry one event and audit; different payload same key a conflict | Designer default, locked for M8 |
| Corrections | Append-only, with full history and deterministic latest event | Designer default, locked for M8 |
| CSV | Full chronological event register with safe spreadsheet encoding; no latest-only evidence loss | Designer default, locked for M8 |
| Browser reset | ADMIN-only, explicit nonproduction demo/extra flag plus canonical allowlisted *disposable* SQLite DB; preserve all findings and their capture audits | Designer default, locked for M8 |
| CLI seed | Refuse before deleting any records when feedback exists | Designer default, locked for M8 |
| Demo script | Canonical staged 10-minute guide adapted to actual routes, explicit prep/rehearsal and M7 clock separation | PROTOTYPE_SPEC §12 + designer adaptation |
| Database | SQLite through M8; PostgreSQL/Docker remains M9 *after* meeting findings and separate authorization | Existing specification |
| File/commit limit | At most five changed tracked files per M8 implementation slice unless this owner explicitly waives the limit **for M8**; separate task commits and real `npm run verify` | Existing `AGENTS.md` |
| Implementation status | Blueprint is final and ready for an implementation handoff, **not** an assertion that coding or tests have been done | Verified execution boundary |

### 12.2 Remaining **genuinely blocking** decisions

**None remain at the product-design / owner-preference level for M8.** The selected A mode resolves the one original architectural question. The implementer can use the defaults above; there is no reason to ask the owner for participant names, a meeting date, a future hosting URL, new authentication methods or specific university timetabling policies in order to build M8.

There are **execution-time safety conditions** that must block the *affected operation* until checked; they are not unresolved choices:

1. **Changed branch head or dirty user workspace:** verify `m8-meeting-tools-polish` HEAD again and reconcile source before applying any patch. Never overwrite intervening work.
2. **Unknown/protected target database:** reset must fail closed until a dedicated, correctly configured, disposable synthetic SQLite fixture exists. Never redirect to `dev.db` or any existing non-demo DB. For a demo with reset disabled, all other M8 features remain usable.
3. **Unexpected data, unsafe foreign keys, or migration incompatibility:** stop the destructive reset/migration; preserve existing rows; inspect or propose a narrowly scoped safe migration/test before proceeding. Do not claim success with partial data loss.
4. **No demonstrated origin/role protection or rollback:** do not ship the capture/reset endpoint until negative tests establish no unauthorized writes, idempotency and atomic preservation.
5. **New dependency, substantial scope increase or more than five changed files in a slice:** seek explicit owner approval only if truly unavoidable; first consider splitting the slice or using a no-dependency approach.
6. **Attendance prerequisites missing:** explain unsupported semester/date, unconfigured M7 synthetic server clock, or missing publication and disable that demonstration stage rather than fabricate a success. This does **not** block assumption capture and CSV export.

**Non-blocking information for the actual meeting:** the attendee count, names, exact date, who owns rooms, official term calendar, approval chain, lecturer workloads, QR attendance rules, student-device availability and real institutional data-access permissions are all subjects to *discover or confirm* in the meeting. M8 must not silently turn them into official requirements.

**Future approvals, not current M8 design blockers:** the user will separately authorize implementation through the established ChatGPT Work process; a remote `master` merge follows automated verification **and owner manual acceptance**. Deployment on real university data and the M9 PostgreSQL transition each need their own later decisions.

## 13. Explicit exclusions and remaining institutional questions

Do not code a final attendance policy, official semester 2 dates, registrar authority, actual room ownership, official student records, staff eligibility, room capacity exceptions, lecturer workload policy, academic-year cycle, GPS attendance solution or native app from this blueprint. Those are exactly the assumptions stakeholders should confirm or challenge. The prototype's success metric is **credible discussion plus retrievable findings**, not pretending requirements are settled.

**Design status at handoff:** `M8 v1.1 FINALIZED / OWNER SELECTED PRESENTER-ENTERED MODE A / NO UNRESOLVED PRODUCT-DESIGN BLOCKERS / IMPLEMENTATION NOT STARTED / AUTOMATED M8 TESTS NOT EXECUTED / GITHUB SOURCE BRANCH UNCHANGED`. The implementer should use the verified baseline and these finalized defaults, not re-open the presenter/participant interaction question.
