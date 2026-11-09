import { z } from "zod";
/** Canonical unvalidated wording. ASSUMPTION-1 through ASSUMPTION-18 map to PROTOTYPE_SPEC §9. */
export const ASSUMPTIONS = [
    {
        "key": "A1",
        "text": "Timetables are shared via WhatsApp",
        "prompt": "How are official timetables issued, changed and distributed?",
        "tag": "ASSUMPTION-1"
    },
    {
        "key": "A2",
        "text": "Each department has a timetabling representative",
        "prompt": "Who prepares and submits departmental needs?",
        "tag": "ASSUMPTION-2"
    },
    {
        "key": "A3",
        "text": "One whole-year timetable with two semesters",
        "prompt": "What is the planning cycle?",
        "tag": "ASSUMPTION-3"
    },
    {
        "key": "A4",
        "text": "Departments own rooms; unclaimed rooms are shared",
        "prompt": "Who controls ownership, allocation and lending?",
        "tag": "ASSUMPTION-4"
    },
    {
        "key": "A5",
        "text": "Clashes mostly follow lecturer reschedules",
        "prompt": "Which clashes occur and who approves changes?",
        "tag": "ASSUMPTION-5"
    },
    {
        "key": "A6",
        "text": "Attendance is on paper registers",
        "prompt": "Which attendance mechanisms are used?",
        "tag": "ASSUMPTION-6"
    },
    {
        "key": "A7",
        "text": "Computing runs a GPS attendance pilot",
        "prompt": "What pilot exists and who maintains it?",
        "tag": "ASSUMPTION-7"
    },
    {
        "key": "A8",
        "text": "Semester dates are August–December and January–April",
        "prompt": "What calendar and exceptions are authoritative?",
        "tag": "ASSUMPTION-8"
    },
    {
        "key": "A9",
        "text": "Scheduling slot grid and teaching days",
        "prompt": "Which periods, breaks and days are valid?",
        "tag": "ASSUMPTION-9"
    },
    {
        "key": "A10",
        "text": "Lecturer/group workload limits",
        "prompt": "Are limits mandatory or recommended?",
        "tag": "ASSUMPTION-10"
    },
    {
        "key": "A11",
        "text": "Capacity must meet expected enrollment, no overbooking",
        "prompt": "Who approves capacity exceptions?",
        "tag": "ASSUMPTION-11"
    },
    {
        "key": "A12",
        "text": "HoD approves departmental submissions",
        "prompt": "What is the actual approval chain?",
        "tag": "ASSUMPTION-12"
    },
    {
        "key": "A13",
        "text": "Registrar/officer publishes timetables",
        "prompt": "Who has final publication authority?",
        "tag": "ASSUMPTION-13"
    },
    {
        "key": "A14",
        "text": "Students have smartphones",
        "prompt": "What approved alternatives are needed?",
        "tag": "ASSUMPTION-14"
    },
    {
        "key": "A15",
        "text": "Every unit has 3 contact hours/week, split 2+1",
        "prompt": "What determines hours and lecture/lab splits?",
        "tag": "ASSUMPTION-15"
    },
    {
        "key": "A16",
        "text": "SOEN 321 Professional Attachment is not timetabled",
        "prompt": "How are attachments represented?",
        "tag": "ASSUMPTION-16"
    },
    {
        "key": "A17",
        "text": "Pilot class is Year 4",
        "prompt": "What is the authoritative pilot cohort?",
        "tag": "ASSUMPTION-17"
    },
    {
        "key": "A18",
        "text": "Computer-based units need a lab once per week",
        "prompt": "What determines lab frequency and equipment?",
        "tag": "ASSUMPTION-18"
    }
] as const;
export type AssumptionKey = (typeof ASSUMPTIONS)[number]["key"];
export const SOURCE_ROLES = ["NOT_SPECIFIED", "TIMETABLING_STAFF", "REGISTRAR_OR_ACADEMIC_ADMIN", "DEPARTMENT_REP", "HEAD_OF_DEPARTMENT", "LECTURER", "STUDENT", "OTHER"] as const;
export const FEEDBACK_DISCLOSURE = "Feedback entered by the prototype presenter, reflecting a stakeholder statement. Not an official university approval.";
export const FeedbackSchema = z.object({
    assumptionKey: z.string().refine(v => ASSUMPTIONS.some(a => a.key === v), "Choose A1–A18"),
    verdict: z.enum(["CONFIRM", "REJECT", "MODIFY"]),
    note: z.string().trim().max(2000).default(""),
    meetingLabel: z.string().trim().max(120).default(""),
    sourceRole: z.enum(SOURCE_ROLES).default("NOT_SPECIFIED"),
    submissionKey: z.string().uuid(),
}).strict().superRefine((v, c) => {
    if (v.verdict !== "CONFIRM" && !v.note)
        c.addIssue({ code: "custom", path: ["note"], message: "Explain Reject or Modify" });
});
export type FeedbackInput = z.infer<typeof FeedbackSchema>;
