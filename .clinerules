# AGENTS.md — Rules for the AI coding agent (TAMS prototype)

> Copy this file to the repo root. Also copy it to the path your tool reads:
> Cline → `.clinerules` · GitHub Copilot → `.github/copilot-instructions.md` · others → `AGENTS.md`.

## 0. What you are building
A **demo-ready prototype** of the Timetabling and Attendance Management System (TAMS) for Kisii University.
It will be shown to the university's timetabling department so they can correct our assumptions.
It is NOT the final product. It must be small, correct, runnable at all times, and honest about being a prototype.

## 1. Start of every session (mandatory, in this order)
1. Read `AGENTS.md` (this file).
2. Read `PROGRESS.md` (what is done, what is next, known problems).
3. Read ONLY the section of `PROTOTYPE_SPEC.md` for the task you were given.
4. Reply with a plan: files you will create or change (max 5), and the checks you will run. Then wait for approval if your tool asks, otherwise proceed.

## 2. Working rules
- Do ONE task per session (tasks have IDs such as `M3-T2`). Never start the next task on your own.
- Change at most 5 files per task. If you need more, stop and propose splitting the task.
- The app must run (`npm run dev`) and `npm run verify` must pass at the end of every task. Never leave it broken.
- Do not refactor, rename, or "improve" code outside the task.
- Database is SQLite for the prototype (see spec §4). Do not add Docker or PostgreSQL files until task M9-T1.
- Do not add dependencies. If you believe one is needed, stop and ask, giving the name, purpose, size, and a no-dependency alternative.
- Do not change `PROTOTYPE_SPEC.md`, the seed data meaning, or the test expectations unless the task says so.
- Keep every file under 300 lines. Split by responsibility.
- If something is ambiguous, ask ONE specific question and stop. Do not guess silently.
- If the same error persists after 3 attempts, STOP. Report: the error, what you tried, your best hypothesis. Do not keep looping.

## 3. Code rules
- TypeScript strict mode. No `any`. No `// @ts-ignore`.
- Business logic lives in `src/domain/` as **pure functions** (no database, no network, no `Date.now()`; pass the clock in). This makes it testable.
- Validate every external input with `zod` (or the validator named in the spec).
- Authorization is enforced **on the server for every route/action**, never only by hiding buttons.
- Never put secrets in code. Use `.env` (git-ignored) and keep `.env.example` current.
- Passwords are hashed. QR tokens never contain personal data.
- Seed data is synthetic. Never add real names, registration numbers, or phone numbers.
- Every user-facing error must say what went wrong and what to do (e.g. "Room LH1 is already used by SE-Y3 at that time").

## 4. Testing rules
- Every domain function gets unit tests: at least one normal case, one boundary case, one failure case.
- Scheduling tests must include **deliberately conflicting** inputs, not only clean ones.
- Never delete, skip, or weaken a test to make it pass. If a test seems wrong, explain why and ask.
- `npm run verify` runs: typecheck → lint → unit tests → seed integrity check. Paste its full output in your final message.

## 5. Honesty rules (most important)
- Never say a task is done unless you ran the checks and pasted the real output.
- Never invent test results, timings, screenshots, or metrics.
- Anything unfinished is marked `// STUB:` in code and shown as "Not implemented in prototype" in the UI.
- The UI always shows a banner: "Prototype — sample data. Not official university records."
- Anything based on an unverified assumption about Kisii's process carries a tag `ASSUMPTION-<n>` in code comments (list in spec §9).

## 6. Git rules
- One branch per milestone: `m3-validator`. One commit per task: `M3-T2: add lecturer overlap check`.
- Never force-push. Never commit `.env`, `node_modules`, database files.

## 7. End of every task (mandatory)
1. Run `npm run verify` and paste the output.
2. Append to `PROGRESS.md` using this template:
```
## <date> <task id> <title>
- Done: <one line>
- Files changed: <list>
- Verify: PASS / FAIL (paste output summary)
- Decisions: <any choice you made and why>
- Known problems: <anything incomplete>
- Next suggested task: <id>
```
3. Final message must use the **Task report** format: Summary · Files changed · Verify output · Acceptance criteria (each item ticked or not, with evidence) · Open questions.

## 8. Out of scope (do not build, do not suggest)
Exams, grades, fees, payroll, LMS features, biometrics, real student-portal integration, native mobile apps, payments, email/SMS sending, AI features.
