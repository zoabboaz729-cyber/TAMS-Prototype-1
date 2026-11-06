/**
 * Secure server-side orchestration for publishing a validated DRAFT timetable
 * version (M4-T3a) on top of the accepted M3 validator. The injected store
 * interface, the validated-snapshot token and the typed result live in
 * `draftPublishContract.ts`; this module only decides what may run, what the
 * validator is allowed to see, and whether the answer may be committed. The
 * Prisma adapter is M4-T3b — nothing here touches a database.
 *
 * Rules enforced here, never in the UI:
 * - PUBLISH_TIMETABLE is decided BEFORE any store call, so an unauthenticated or
 *   forbidden caller triggers zero reads and zero writes. The actor comes from
 *   the authenticated session only, never from a request field, and the request
 *   schema is `.strict()` so a forged status, actor or publication time is
 *   refused as INVALID_INPUT before a read.
 * - The target must exist, be stored DRAFT, carry a valid semester and not
 *   already hold a publication time. PUBLISHED and ARCHIVED versions are refused
 *   and are never turned back into drafts; an unreadable stored status throws in
 *   the adapter and becomes INTERNAL_ERROR, never a guess.
 * - Publication never edits a teaching session. The draft that is validated is
 *   the draft that is published.
 * - The M3 validator has the last word: any hard violation (venue, lecturer or
 *   group overlap, capacity, venue type, lecturer or venue unavailability,
 *   out-of-slot) refuses, and so does an `incomplete` outcome — an empty
 *   violations list is never success when required context was missing.
 * - A DRAFT with zero entries is refused as EMPTY_DRAFT. Proving that every
 *   teaching's weekly sessions are present is a separate policy question, not a
 *   rule invented here (DECISIONS.md M4-T3a).
 * - A failed store query throws and becomes INTERNAL_ERROR. It is never degraded
 *   into an empty entry, venue or availability list, and a published-version
 *   read that returns rows outside the target semester fails closed so no
 *   version of another semester can be archived.
 * - The one atomic `publishDraft` call carries the fingerprint of exactly what
 *   this validation read, so a draft — or a capacity, availability or policy
 *   input underneath it — that changed between the read and the commit is
 *   refused as STALE with nothing committed.
 */
import { decideAccess } from "@/domain/access";
import { unavailablePeriodsFromRecords, type StoredUnavailablePeriod } from "@/domain/lecturerAvailability";
import type { Actor } from "@/domain/permissions";
import { DEFAULT_POLICY, type PolicyConfig } from "@/domain/policy";
import { validateEntries } from "@/domain/validator";
import type { EntryInput, TeachingInfo, ValidationContext, VenueInfo, VenueUnavailablePeriod } from "@/domain/validator";
import type { DraftEntryRow, LecturerUnavailableRow, TeachingRow, VenueRow, VenueUnavailableRow } from "@/server/draftValidation";
import {
  publishInputMessage, publishSnapshotFingerprint, PublishDraftInputSchema, PublishSemesterSchema,
} from "@/server/draftPublishContract";
import type {
  DraftPublishResult, DraftPublishStore, PublishDraftRequest, PublishSnapshot, PublishTransactionInput, PublishVersionRow,
} from "@/server/draftPublishContract";

// ---------------------------------------------------------------------------
// Database row -> accepted validator shape (mirrors the M3-T2a loader)
// ---------------------------------------------------------------------------

/** A stored DRAFT whose own row contradicts itself is never published. */
function invalidVersionData(version: PublishVersionRow): DraftPublishResult | null {
  if (!PublishSemesterSchema.safeParse(version.semester).success) {
    return {
      ok: false, kind: "INVALID_VERSION_DATA", versionId: version.id, reason: "SEMESTER_OUT_OF_RANGE",
      message: `Version ${version.id} records semester ${version.semester}, which is not a semester this prototype knows (1 or 2). Correct the version before publishing.`,
    };
  }
  if (version.publishedAt !== null) {
    return {
      ok: false, kind: "INVALID_VERSION_DATA", versionId: version.id, reason: "PUBLISHED_AT_ON_DRAFT",
      message: `Version ${version.id} is a DRAFT but already carries a publication time, so its state is inconsistent. Check it before publishing.`,
    };
  }
  return null;
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** An id list with no entries must not cost a database round trip. */
function queryByIds<T>(
  ids: readonly string[],
  query: (ids: readonly string[]) => Promise<T[]>,
): Promise<T[]> {
  return ids.length === 0 ? Promise.resolve([]) : query(ids);
}

function entryInputOf(row: DraftEntryRow): EntryInput {
  return { id: row.id, teachingId: row.teachingId, venueId: row.venueId, day: row.day, start: row.start, end: row.end };
}

function teachingInfoOf(row: TeachingRow): TeachingInfo {
  return {
    lecturerId: row.lecturerId,
    groupId: row.groupId,
    expectedSize: row.expectedSize,
    venueTypeRequired: row.venueTypeRequired,
    unitCode: row.unitCode,
  };
}

function venueInfoOf(row: VenueRow): VenueInfo {
  return { capacity: row.capacity, type: row.type, code: row.code };
}

/** `available: true` rows restrict nothing; the accepted domain rule decides. */
function lecturerPeriodsByLecturer(rows: readonly LecturerUnavailableRow[]): Record<string, StoredUnavailablePeriod[]> {
  const grouped = new Map<string, LecturerUnavailableRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.lecturerId);
    if (bucket === undefined) grouped.set(row.lecturerId, [row]);
    else bucket.push(row);
  }
  return Object.fromEntries(
    [...grouped].map(([lecturerId, records]) => [lecturerId, unavailablePeriodsFromRecords(records)]),
  );
}

function venuePeriodsByVenue(rows: readonly VenueUnavailableRow[]): Record<string, VenueUnavailablePeriod[]> {
  const grouped = new Map<string, VenueUnavailablePeriod[]>();
  for (const row of rows) {
    const period: VenueUnavailablePeriod = {
      day: row.day,
      start: row.start,
      end: row.end,
      ...(row.reason === null ? {} : { reason: row.reason }),
    };
    const bucket = grouped.get(row.venueId);
    if (bucket === undefined) grouped.set(row.venueId, [period]);
    else bucket.push(period);
  }
  return Object.fromEntries(grouped);
}

function validationContextOf(snapshot: PublishSnapshot): ValidationContext {
  return {
    teachings: Object.fromEntries(snapshot.teachings.map((row) => [row.id, teachingInfoOf(row)] as const)),
    venues: Object.fromEntries(snapshot.venues.map((row) => [row.id, venueInfoOf(row)] as const)),
    lecturerUnavailable: lecturerPeriodsByLecturer(snapshot.lecturerUnavailable),
    venueUnavailable: venuePeriodsByVenue(snapshot.venueUnavailable),
  };
}

/**
 * Week order, mirroring the M3-T2a loader so `MissingContextError.entryIndex`
 * names the row the officer reads. A day the policy does not list sorts last;
 * the validator still reports that entry as OUT_OF_SLOT.
 */
function sortEntriesByWeek(rows: readonly DraftEntryRow[], policy: PolicyConfig): DraftEntryRow[] {
  const dayRank = new Map(policy.days.map((day, index) => [day, index]));
  const unlistedDay = policy.days.length;
  return [...rows].sort((a, b) => {
    const rankA = dayRank.get(a.day) ?? unlistedDay;
    const rankB = dayRank.get(b.day) ?? unlistedDay;
    if (rankA !== rankB) return rankA - rankB;
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Publish one validated DRAFT, archiving the PUBLISHED versions of its own
 * semester, or refuse with a typed reason and commit nothing. Order: session →
 * PUBLISH_TIMETABLE → request shape → version → entries → validation context →
 * M3 validator → same-semester published set → one atomic transaction.
 *
 * `now` is the server clock, injected so the timestamp is testable; a future
 * server action must never pass a value derived from a request field.
 */
export async function performDraftPublish(
  store: DraftPublishStore,
  actor: Actor | null,
  request: PublishDraftRequest,
  policy: PolicyConfig = DEFAULT_POLICY,
  now: () => Date = () => new Date(),
): Promise<DraftPublishResult> {
  // 1 and 2. Authorization before anything else, so a denied caller provably
  // caused zero store operations.
  if (actor === null) return { ok: false, kind: "UNAUTHENTICATED" };
  if (decideAccess(actor, "PUBLISH_TIMETABLE").status !== "ALLOW") {
    return { ok: false, kind: "FORBIDDEN" };
  }

  // 3. Untrusted request shape. Still no store call.
  const parsed = PublishDraftInputSchema.safeParse(request);
  if (!parsed.success) {
    return { ok: false, kind: "INVALID_INPUT", message: publishInputMessage(parsed.error) };
  }

  try {
    // 4. The target exists, is a DRAFT, and is internally consistent.
    const version = await store.findVersion(parsed.data.versionId);
    if (version === null) return { ok: false, kind: "VERSION_NOT_FOUND", versionId: parsed.data.versionId };
    if (version.status !== "DRAFT") {
      return { ok: false, kind: "NOT_DRAFT", versionId: version.id, storedStatus: version.status };
    }
    const corrupt = invalidVersionData(version);
    if (corrupt !== null) return corrupt;

    // 5. Its own entries only, re-filtered by version id so a broken WHERE
    // clause cannot publish another version's rows. An empty draft is refused
    // before the context reads: there is nothing to validate or to show anyone.
    const rows = await store.listEntriesByVersion(version.id);
    const entries = sortEntriesByWeek(rows.filter((row) => row.versionId === version.id), policy);
    if (entries.length === 0) return { ok: false, kind: "EMPTY_DRAFT", versionId: version.id };

    // 6. Every input the accepted validator needs, from the same reads the
    // fingerprint will describe.
    const venueIds = uniqueIds(entries.map((row) => row.venueId));
    const teachingRows = await queryByIds(uniqueIds(entries.map((row) => row.teachingId)), (ids) =>
      store.listTeachingsByIds(ids),
    );
    const venueRows = await queryByIds(venueIds, (ids) => store.listVenuesByIds(ids));
    const lecturerRows = await queryByIds(uniqueIds(teachingRows.map((row) => row.lecturerId)), (ids) =>
      store.listLecturerUnavailableByLecturerIds(ids),
    );
    const venueUnavailableRows = await queryByIds(venueIds, (ids) => store.listVenueUnavailableByVenueIds(ids));
    const snapshot: PublishSnapshot = {
      version,
      entries,
      teachings: teachingRows,
      venues: venueRows,
      lecturerUnavailable: lecturerRows,
      venueUnavailable: venueUnavailableRows,
      policy,
    };

    // 7. Mandatory final M3 validation. "incomplete" is refused on its own
    // terms: missing context is not an empty violations list to be read as ok.
    const validation = validateEntries(entries.map(entryInputOf), validationContextOf(snapshot), policy);
    if (validation.status === "incomplete") {
      return {
        ok: false,
        kind: "INCOMPLETE_VALIDATION",
        versionId: version.id,
        violations: validation.violations,
        missingContext: validation.missingContext,
      };
    }
    if (validation.violations.length > 0) {
      return { ok: false, kind: "HARD_VIOLATIONS", versionId: version.id, violations: validation.violations };
    }

    // 8. What is currently published for this semester. Anything the read
    // returns outside that scope is a broken read, and archiving the wrong
    // semester is worse than refusing to publish, so this fails closed.
    const publishedRows = await store.listPublishedVersionsBySemester(version.semester);
    const published = publishedRows.filter(
      (row) => row.status === "PUBLISHED" && row.semester === version.semester && row.id !== version.id,
    );
    if (published.length !== publishedRows.length) {
      throw new Error(`published-version read for semester ${version.semester} returned out-of-scope rows`);
    }
    const publishedVersionIds = published.map((row) => row.id).sort();

    // 9. One atomic transaction: archive those, publish this, audit it — or
    // nothing. The fingerprint is what the store must reproduce from its own
    // reads inside the transaction before it is allowed to write.
    const publishedAt = now();
    const input: PublishTransactionInput = {
      versionId: version.id,
      semester: version.semester,
      publishedAt,
      expected: { snapshotFingerprint: publishSnapshotFingerprint(snapshot), publishedVersionIds, policy },
      audit: {
        actorId: actor.id,
        action: "TIMETABLE_PUBLISH",
        entity: "TimetableVersion",
        reason: `Published ${entries.length} entries of draft ${version.id} (semester ${version.semester}); archived ${
          publishedVersionIds.length === 0 ? "no earlier version" : publishedVersionIds.join(", ")
        }.`,
      },
    };
    const outcome = await store.publishDraft(input);
    if ("stale" in outcome) return { ok: false, kind: "STALE", reason: outcome.reason };

    // The ids and semester the store actually committed — never a claim.
    return { ok: true, versionId: version.id, semester: version.semester, archivedVersionIds: outcome.archivedVersionIds, publishedAt };
  } catch (error) {
    // Only the message reaches the log; the caller gets a code, never SQL or a
    // connection detail, and never a claim that anything was published.
    console.error("[draftPublish] publication failed:", error instanceof Error ? error.message : String(error));
    return { ok: false, kind: "INTERNAL_ERROR" };
  }
}
