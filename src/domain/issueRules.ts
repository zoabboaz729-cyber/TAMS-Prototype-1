import { z } from "zod";
export const IssueStatusSchema = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
export const IssueSubmitSchema = z.object({ text: z.string().trim().min(10).max(1000), venueId: z.string().min(1).max(100).nullable().optional() }).strict();
export const IssueUpdateSchema = z.object({ issueId: z.string().min(1).max(100), expectedStatus: IssueStatusSchema, nextStatus: IssueStatusSchema, note: z.string().trim().max(500).optional() }).strict();
export function issueTransition(from: string, to: string, note = ""): string | null {
    if (!IssueStatusSchema.safeParse(from).success)
        return "INVALID_STORED_DATA";
    if (!({ OPEN: ["IN_PROGRESS", "RESOLVED"], IN_PROGRESS: ["RESOLVED"], RESOLVED: ["IN_PROGRESS", "CLOSED"], CLOSED: [] } as Record<string, string[]>)[from].includes(to))
        return "INVALID_TRANSITION";
    if (!(from === "OPEN" && to === "IN_PROGRESS") && note.trim().length < 3)
        return "NOTE_REQUIRED";
    return null;
}
