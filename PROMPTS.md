# PROMPTS.md — how to drive the agent

## The rule of prompting a weak agent
Small task, one at a time, with the acceptance criteria and the proof you want. Never say "build the timetabling module". Say "do task M3-T1".

## A. Universal task prompt (copy, change only the task ID)
```
Read AGENTS.md, then PROGRESS.md, then only the section of PROTOTYPE_SPEC.md for task <TASK-ID>.
Do exactly that one task and nothing else.
First reply with: the files you will create or change (max 5) and the checks you will run. Then implement.
At the end run `npm run verify`, paste the full output, update PROGRESS.md, and give the Task report
(Summary, Files changed, Verify output, each Acceptance item with evidence, Open questions).
If anything is ambiguous, ask one specific question and stop. If an error repeats 3 times, stop and report.
```

## B. First prompt ever (M0-T1)
Put the three files (`AGENTS.md`, `PROTOTYPE_SPEC.md`, `PROGRESS.md`) in an empty folder first, then:
```
You are starting a new project in this folder. Read AGENTS.md and PROTOTYPE_SPEC.md sections 1 to 5 and 11 (M0).
Do task M0-T1 only. Create the project exactly with the stack in section 4. Do not add anything else.
Follow the universal task procedure from AGENTS.md (plan first, verify, PROGRESS.md, Task report).
```

## C. Review prompt (after any task, in a fresh session)
```
Act as a strict reviewer, not an author. Do NOT change files.
Read AGENTS.md and the acceptance criteria for <TASK-ID> in PROTOTYPE_SPEC.md, then inspect the changes in the last commit.
List: (1) acceptance items that are NOT demonstrably met, (2) rule violations from AGENTS.md, (3) missing tests,
(4) any code that looks like a fake or hard-coded result. Quote file and line for each point.
```

## D. Bug-fix prompt
```
Bug: <what you did, what you expected, what happened, exact error text>.
Do not change anything unrelated. First write a failing test that reproduces it. Then fix it. Then run `npm run verify`.
Report root cause in two sentences.
```

## E. Context handoff prompt (when the chat gets long or the agent forgets)
Start a NEW session and paste:
```
New session. Read AGENTS.md and PROGRESS.md and tell me, in 5 lines, where the project stands and what the next task is.
Do not write code yet.
```

## F. Rescue prompt (agent is looping or making a mess)
```
Stop. Do not edit any more files. Run `git status` and `git diff --stat` and tell me what changed since the last passing commit.
Then recommend: keep, partially keep, or revert, with reasons. Wait for my decision.
```
(Your safety net: commit after every passing task, so `git reset --hard` returns you to a good state.)

## G. What to send me (Claude) after each task, so I can verify properly
Paste this block into our chat:
```
TASK: <id>
VERIFY OUTPUT: <paste>
PROGRESS.md entry: <paste>
FILES CHANGED: <git diff --stat>
ONE SCREENSHOT or description of the screen: <attach>
PROBLEMS / agent questions: <paste>
```
I will check acceptance items, review the risky files if you paste them, and write the next prompt. For the big logic files (validator, generator, attendance rules) paste the file itself so I can review it line by line.

## H. Milestone gate checklist (before starting the next milestone)
- `npm run verify` passes on a clean checkout of the branch
- All acceptance items for the milestone ticked with evidence
- App runs; the milestone's screens work in a browser on a phone-size window
- Committed and merged to `main`; `PROGRESS.md` status updated
