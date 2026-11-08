/** M4 extension. Runs before preview and again inside M4's write transaction. */
import { createHash } from "node:crypto";
import { hasStarted } from "@/domain/termCalendar";
import { readM6Snapshot, assessSnapshot, type M6Client } from "./m6Snapshot";
export async function readM6PublicationGuard(tx: M6Client, versionId: string, now: Date) {
    const s = await readM6Snapshot(tx, versionId);
    const current = await tx.timetableVersion.findMany({ where: { semester: s.version.semester, status: "PUBLISHED" }, orderBy: { id: "asc" } });
    const baseline = current.length === 1 ? await readM6Snapshot(tx, current[0].id) : null;
    const fingerprint = createHash("sha256").update(JSON.stringify([s.fingerprint, current, baseline?.fingerprint ?? null])).digest("hex");
    let problem: string | null = null;
    if (s.version.basePublishedVersionId && (current.length !== 1 || s.version.basePublishedVersionId !== current[0].id))
        problem = "STALE_SOURCE";
    if (!s.version.basePublishedVersionId && baseline?.exceptions.length)
        problem = "STALE_SOURCE";
    // Legacy M0-M5 publication rules are preserved for schedules without dated data.
    if (!problem && (s.version.basePublishedVersionId || s.exceptions.length)) {
        try {
            const assessment = assessSnapshot(s);
            if (assessment.status === "INCOMPLETE")
                problem = "INCOMPLETE_VALIDATION";
            else if (assessment.status === "CONFLICTED")
                problem = "HARD_VIOLATIONS";
            const canonical = (x: typeof s.exceptions[number], snap: typeof s) => {
                const e = snap.entries.find(e => e.id === x.entryId);
                return JSON.stringify([e?.teachingId, e?.venueId, e?.day, e?.start, e?.end, x.originalDate, x.replacementDate, x.replacementStart, x.replacementEnd]);
            };
            const old = new Set(baseline?.exceptions.map(x => canonical(x, baseline)) ?? []);
            for (const x of s.exceptions) {
                const entry = s.entries.find(e => e.id === x.entryId)!;
                if (!old.has(canonical(x, s)) && (hasStarted(x.originalDate, entry.start, now) || hasStarted(x.replacementDate, x.replacementStart, now)))
                    problem = "PAST_NEW_EXCEPTION";
            }
        }
        catch {
            problem = s.term ? "INVALID_OCCURRENCE_DATA" : "TERM_NOT_CONFIGURED";
        }
    }
    return { fingerprint, problem };
}
