/**
 * Secure server-side orchestration for generating a new DRAFT timetable
 * version (M4-T2a) on top of the accepted M4-T1 pure generator. The injected
 * store interface, payload shapes and typed result are in
 * `draftGenerateContract.ts`; this module only decides what may run, what data
 * the generator is allowed to see, and whether the answer may be persisted.
 *
 * Rules enforced here, never in the UI:
 * - GENERATE_TIMETABLE is decided BEFORE any store call, so an unauthenticated
 *   or forbidden caller triggers zero reads and zero writes. The actor comes
 *   from the authenticated session only, never from a request field.
 * - The request carries an explicit semester, every teaching row is re-checked
 *   against it, and the source draft's own semester must match, so two
 *   semesters can never be combined into one draft.
 * - A source version must exist and be DRAFT; PUBLISHED/ARCHIVED are refused,
 *   and the source itself is never written to.
 * - Only the source's LOCKED rows become `fixedEntries`; unlocked draft rows are
 *   proposals, not commitments, and are deliberately not treated as fixed.
 * - A failed store query throws and becomes INTERNAL_ERROR. It is never
 *   degraded into an empty teaching or venue list.
 * - Deliberate fail-closed prototype policy: nothing incomplete is persisted.
 *   Any `unplaced` activity or locked-row problem, and any hard violation or
 *   incomplete final validation left by the finished board, is returned as
 *   structured information with zero writes. An empty `unplaced` list alone is
 *   not proof of validity — the accepted M3 validator has the last word, and a
 *   later approved workflow may add durable warning metadata.
 * - Persistence is the one atomic store operation, guarded by the source
 *   fingerprint, so a source draft or locked row that changed while the input
 *   was loading fails as STALE with nothing committed.
 */
import { decideAccess } from "@/domain/access";
import { unavailablePeriodsFromRecords } from "@/domain/lecturerAvailability";
import { generateTimetable, type GeneratorInput } from "@/domain/generator";
import type { Actor } from "@/domain/permissions";
import { DEFAULT_POLICY, type PolicyConfig } from "@/domain/policy";
import { validateEntries, type ValidationContext } from "@/domain/validator";
import type { DraftEntryRow, DraftVersionRow } from "@/server/draftValidation";
import {
  GenerateDraftInputSchema,
  generateInputMessage,
  groupBy,
  lockedFingerprint,
  queryByIds,
  toGeneratorPeriods,
  toGeneratorVenue,
  toTeachingInfo,
  toValidatorVenue,
  toVenueUnavailablePeriods,
  type DraftGenerateResult,
  type DraftGenerateStore,
  type GenerateAuditDraft,
  type GeneratedDraftPayload,
  type GenerateDraftRequest,
  type GenerateSourceToken,
  type GenerationProblem,
  type GenerationTeachingRow,
} from "@/server/draftGenerateContract";

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Generate a complete draft for one semester and persist it as a NEW DRAFT
 * version, or refuse with a typed reason and write nothing. Order: session →
 * GENERATE_TIMETABLE → input validation → source draft → semester dataset →
 * locked rows → generator → M3 validator → one atomic persistence.
 */
export async function performDraftGenerate(
  store: DraftGenerateStore,
  actor: Actor | null,
  request: GenerateDraftRequest,
  policy: PolicyConfig = DEFAULT_POLICY,
): Promise<DraftGenerateResult> {
  if (actor === null) return { ok: false, kind: "UNAUTHENTICATED" };
  if (decideAccess(actor, "GENERATE_TIMETABLE").status !== "ALLOW") {
    return { ok: false, kind: "FORBIDDEN" };
  }
  const parsed = GenerateDraftInputSchema.safeParse(request);
  if (!parsed.success) {
    return { ok: false, kind: "INVALID_INPUT", message: generateInputMessage(parsed.error) };
  }
  const semester = parsed.data.semester;
  const sourceVersionId = parsed.data.sourceVersionId ?? null;

  try {
    let source: DraftVersionRow | null = null;
    let lockedRows: DraftEntryRow[] = [];
    if (sourceVersionId !== null) {
      source = await store.findVersion(sourceVersionId);
      if (source === null) return { ok: false, kind: "SOURCE_NOT_FOUND", sourceVersionId };
      if (source.status !== "DRAFT") {
        return {
          ok: false,
          kind: "SOURCE_NOT_DRAFT",
          sourceVersionId: source.id,
          storedStatus: source.status,
        };
      }
      const sourceId = source.id;
      lockedRows = (await store.listLockedEntriesByVersion(sourceId)).filter(
        (row) => row.versionId === sourceId && row.locked,
      );
    }

    const teachingRead = await store.listTeachingsForSemester(semester);
    const venues = await store.listActiveVenues();
    const scopedTeachings = teachingRead.teachings.filter(
      (row) => row.semester === semester && row.scheduled,
    );
    const teachingById = new Map<string, GenerationTeachingRow>();
    for (const row of scopedTeachings) {
      if (!teachingById.has(row.id)) teachingById.set(row.id, row);
    }
    const venueById = new Map(venues.map((venue) => [venue.id, venue] as const));
    const lockedIds = new Set(lockedRows.map((row) => row.id));

    // Each problem below is a reason the input cannot be trusted. None may be
    // guessed around, and none of them reaches the generator or the write.
    const problems: GenerationProblem[] = [];
    if (!teachingRead.semesterExists) {
      problems.push({
        kind: "SEMESTER_NOT_FOUND",
        message: `Semester ${semester} has no units, so there is nothing to timetable. Check the semester or record its units first.`,
      });
    } else if (scopedTeachings.length === 0) {
      problems.push({
        kind: "NO_SCHEDULED_TEACHINGS",
        message: `Semester ${semester} has no scheduled teaching assignments, so nothing was generated and no draft was created.`,
      });
    }
    if (scopedTeachings.length !== teachingRead.teachings.length) {
      problems.push({
        kind: "DATASET_SCOPE_MISMATCH",
        message: `The teaching read for semester ${semester} returned rows from another semester or a unit marked not scheduled, so the read was refused.`,
      });
    }
    if (venues.length === 0) {
      problems.push({
        kind: "NO_ACTIVE_VENUES",
        message: "No active venue exists, so nothing could be placed. Check the venue register status.",
      });
    }
    if (source !== null && source.semester !== semester) {
      problems.push({
        kind: "SOURCE_SEMESTER_MISMATCH",
        message: `Source draft ${source.id} belongs to semester ${source.semester}, but semester ${semester} was requested. Choose the matching semester.`,
        sourceVersionId: source.id,
      });
    }
    for (const row of lockedRows) {
      if (!teachingById.has(row.teachingId)) {
        problems.push({
          kind: "SOURCE_ENTRY_UNRESOLVED",
          entryId: row.id,
          message: `Locked entry ${row.id} teaches a unit that is not scheduled in semester ${semester}, so it could not be kept. Fix the source draft or unlock the entry.`,
        });
      } else if (!venueById.has(row.venueId)) {
        problems.push({
          kind: "SOURCE_ENTRY_UNRESOLVED",
          entryId: row.id,
          message: `Locked entry ${row.id} uses a venue that is not active, so it could not be kept. Make the venue active or unlock the entry.`,
        });
      }
    }
    if (problems.length > 0) return { ok: false, kind: "INCOMPLETE_INPUT", problems };

    const lecturerIds = [...new Set(scopedTeachings.map((row) => row.lecturerId))];
    const venueIds = [...new Set(venues.map((venue) => venue.id))];
    const lecturerUnavailableRows = await queryByIds(lecturerIds, (ids) =>
      store.listLecturerUnavailableByLecturerIds(ids),
    );
    const venueUnavailableRows = await queryByIds(venueIds, (ids) =>
      store.listVenueUnavailableByVenueIds(ids),
    );
    const lecturerPeriodsById = groupBy(lecturerUnavailableRows, (row) => row.lecturerId);
    const venuePeriodsById = groupBy(venueUnavailableRows, (row) => row.venueId);

    const generatorInput: GeneratorInput = {
      teachings: scopedTeachings,
      venues: venues.map(toGeneratorVenue),
      lecturerUnavailable: Object.fromEntries(
        [...lecturerPeriodsById].map(([lecturerId, rows]) => [lecturerId, toGeneratorPeriods(rows)]),
      ),
      venueUnavailable: Object.fromEntries(
        [...venuePeriodsById].map(([venueId, rows]) => [venueId, toGeneratorPeriods(rows)]),
      ),
      fixedEntries: lockedRows.map((row) => ({
        id: row.id,
        teachingId: row.teachingId,
        venueId: row.venueId,
        day: row.day,
        start: row.start,
        end: row.end,
      })),
    };

    const generated = generateTimetable(generatorInput, policy);
    if (generated.unplaced.length > 0) {
      return {
        ok: false,
        kind: "PARTIAL_GENERATION",
        unplaced: generated.unplaced,
        placedCount: generated.entries.length,
        softScore: generated.softScore,
      };
    }

    // An empty `unplaced` list is not proof of validity: the accepted M3
    // validator judges the finished board, and "incomplete" means data it
    // needed was missing. Either way nothing is persisted.
    const context: ValidationContext = {
      teachings: Object.fromEntries(
        scopedTeachings.map((row) => [row.id, toTeachingInfo(row)] as const),
      ),
      venues: Object.fromEntries(venues.map((venue) => [venue.id, toValidatorVenue(venue)] as const)),
      lecturerUnavailable: Object.fromEntries(
        [...lecturerPeriodsById].map(([lecturerId, rows]) => [
          lecturerId,
          unavailablePeriodsFromRecords(rows),
        ]),
      ),
      venueUnavailable: Object.fromEntries(
        [...venuePeriodsById].map(([venueId, rows]) => [
          venueId,
          toVenueUnavailablePeriods(rows),
        ] as const),
      ),
    };
    const validation = validateEntries(generated.entries, context, policy);
    if (validation.status !== "ok" || validation.violations.length > 0) {
      return {
        ok: false,
        kind: "INVALID_GENERATION",
        violations: validation.violations,
        missingContext: validation.status === "incomplete" ? validation.missingContext : [],
      };
    }

    const expectedSource: GenerateSourceToken | null =
      source === null
        ? null
        : {
            versionId: source.id,
            versionStatus: source.status,
            lockedFingerprint: lockedFingerprint(lockedRows),
          };
    const payload: GeneratedDraftPayload = {
      semester,
      status: "DRAFT",
      createdBy: actor.id,
      sourceVersionId,
      expectedSource,
      softScore: generated.softScore,
      entries: generated.entries.map((entry) => ({
        teachingId: entry.teachingId,
        venueId: entry.venueId,
        day: entry.day,
        start: entry.start,
        end: entry.end,
        locked: lockedIds.has(entry.id),
        sourceEntryId: lockedIds.has(entry.id) ? entry.id : null,
      })),
    };
    const audit: GenerateAuditDraft = {
      actorId: actor.id,
      action: "TIMETABLE_DRAFT_GENERATE",
      entity: "TimetableVersion",
      reason: `Generated ${payload.entries.length} entries for semester ${semester}${
        source === null ? "" : ` from draft ${source.id} (${lockedRows.length} locked kept)`
      }; soft score ${generated.softScore}.`,
    };

    const persisted = await store.persistGeneratedDraft(payload, audit);
    if ("stale" in persisted) return { ok: false, kind: "STALE", sourceVersionId };
    return {
      ok: true,
      versionId: persisted.versionId,
      entryCount: payload.entries.length,
      softScore: generated.softScore,
    };
  } catch (error) {
    console.error(
      "[draftGenerate] generate failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}
