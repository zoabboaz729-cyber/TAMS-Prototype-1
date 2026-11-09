import { ASSUMPTIONS } from "./assumptions";
export type Finding = {
    id: string;
    assumptionKey: string;
    verdict: string;
    note: string | null;
    meetingLabel: string | null;
    sourceRole: string | null;
    recordedByRole: string | null;
    at: Date;
};
export function csvCell(v: string): string {
    // Neutralize formula triggers even after whitespace/control characters.
    const safe = /^[\s\p{Cc}\p{Cf}]*[=+@-]/u.test(v) ? "'" + v : v;
    return '"' + safe.replaceAll('"', '""') + '"';
}
export const CSV_HEADER = "feedback_id,assumption_key,assumption_text,verdict,note,meeting_label,source_role,recorded_by_role,recorded_at_utc,is_latest_for_key";
export function findingsCsv(input: readonly Finding[]): string {
    const rows = [...input].sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const latest = new Map(rows.map(r => [r.assumptionKey, r.id]));
    return CSV_HEADER + "\r\n" + rows.map(r => [r.id, r.assumptionKey, ASSUMPTIONS.find(a => a.key === r.assumptionKey)?.text ?? "Legacy unknown assumption", r.verdict, r.note ?? "", r.meetingLabel ?? "", r.sourceRole ?? "", r.recordedByRole ?? "", r.at.toISOString(), String(latest.get(r.assumptionKey) === r.id)].map(csvCell).join(",") + "\r\n").join("");
}
