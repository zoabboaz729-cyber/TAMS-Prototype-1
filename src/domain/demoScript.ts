/** Illustrative ten-minute discovery script, not measured performance. */
export const DEMO_STEPS = [
    {
        "minute": "0–1",
        "role": "OFFICER",
        "paths": [
            "/assumptions"
        ],
        "expected": "Show all 18 unvalidated assumptions and the presenter capture form.",
        "question": "Which assumptions are wrong or incomplete?",
        "recovery": "Sign in as the demo OFFICER. If findings are unavailable, stop capture and check storage.",
        "assumptions": [
            "A1",
            "A2",
            "A3"
        ]
    },
    {
        "minute": "1–3",
        "role": "DEPT_REP → APPROVER",
        "paths": [
            "/department/submission",
            "/department/review"
        ],
        "expected": "Submit departmental requirements, switch presenter role, then approve.",
        "question": "Who supplies and authorizes inputs?",
        "recovery": "Select the matching sample department; submit before reviewing.",
        "assumptions": [
            "A2",
            "A10",
            "A12"
        ]
    },
    {
        "minute": "3–4",
        "role": "OFFICER",
        "paths": [
            "/venues"
        ],
        "expected": "Compare owned and centrally shared venues and capacities. For this disposable synthetic rehearsal only, use the venue edit screen to change LAB1 capacity from 40 to 50 so the sample 45-person SE-Y4 cohort can be placed. This is a sample-data edit, not a claim about a real room.",
        "question": "Who owns and assigns rooms?",
        "recovery": "Check the venue register; do not equate missing data with no rooms.",
        "assumptions": [
            "A4",
            "A9",
            "A11",
            "A18"
        ]
    },
    {
        "minute": "4–6",
        "role": "OFFICER",
        "paths": [
            "/officer/draft"
        ],
        "expected": "Inspect the original planted clashes, edit one entry, then generate a validated clean candidate.",
        "question": "How are conflicts resolved and schedules approved?",
        "recovery": "Use the actual draft editor generation panel. If generation reports NO_COMPATIBLE_VENUE, complete the explicit synthetic LAB1 capacity preparation in stage 3. Repair validation failures; never bypass publication checks.",
        "assumptions": [
            "A5",
            "A9",
            "A10",
            "A15",
            "A16",
            "A18"
        ]
    },
    {
        "minute": "6–8",
        "role": "OFFICER → viewing role",
        "paths": [
            "/officer/draft",
            "/timetable",
            "/timetable/date"
        ],
        "expected": "Publish only a conflict-free candidate, then show the role-scoped timetable.",
        "question": "How are publication and changes communicated?",
        "recovery": "A fresh seed has no publication. Publish successfully before continuing. Semester 2 dated attendance is unconfigured.",
        "assumptions": [
            "A1",
            "A3",
            "A8",
            "A13",
            "A17"
        ]
    },
    {
        "minute": "8–9",
        "role": "OFFICER",
        "paths": [
            "/venues/status"
        ],
        "expected": "Show schedule-derived free/upcoming/occupied status; identify any M5 display-clock simulation.",
        "question": "Does reservation match your concept of venue occupancy?",
        "recovery": "Select a published semester and relevant date. This board is not sensor-confirmed occupancy.",
        "assumptions": [
            "A4",
            "A5",
            "A9",
            "A11"
        ]
    },
    {
        "minute": "9–10",
        "role": "LECTURER → STUDENT → OFFICER",
        "paths": [
            "/lecturer/attendance",
            "/student/scan",
            "/reports/attendance"
        ],
        "expected": "Demonstrate separate Start class and Open attendance controls, a stored scan receipt, duplicate rejection and scoped reports.",
        "question": "Which attendance controls and alternatives are acceptable?",
        "recovery": "Configure the independent M7 server clock and a published effective lesson. Start class still uses real time; a simulated QR window cannot enable it. Camera needs HTTPS or localhost; use a typed code if unavailable.",
        "assumptions": [
            "A6",
            "A7",
            "A8",
            "A14",
            "A17"
        ]
    }
] as const;
