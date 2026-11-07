import { requireAnyAction } from "@/server/guards";
import { prisma } from "@/server/db";
import { createVenueStatusStore } from "@/server/venueStatusStorePrisma";
import VenueStatusControls from "./VenueStatusControls";
import { canUseVenueDemoClock, readVenueStatus } from "@/server/venueStatus";
import type { VenueStatusRow } from "@/server/venueStatusContract";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const LABELS = { OCCUPIED: "Occupied (scheduled)", UPCOMING: "Upcoming class — presently schedule-free", FREE: "Free (schedule-derived)", UNAVAILABLE: "Unavailable" };
function Timing({ row }: { row: VenueStatusRow }) {
  if (row.unavailableKind === "operational") return <p>Next free: not known until operational status changes.</p>;
  return <>
    {row.unavailableKind === "closure" && <p>Recorded closure.</p>}
    {(row.status === "OCCUPIED" || row.status === "UNAVAILABLE") && row.nextFreeAt &&
      <p>End of recorded block: {row.nextFreeAt.day} {row.nextFreeAt.time} EAT{row.nextFreeOutsideHours ? " (outside assumed teaching hours)" : ""}.</p>}
    {row.nextScheduledAt && <p>Next scheduled start: {row.nextScheduledAt.day} {row.nextScheduledAt.time} EAT.</p>}
  </>;
}
/** Every navigation re-authenticates; the layout alone is not a security boundary. */
export default async function VenueStatusPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAnyAction("VIEW_VENUE_STATUS");
  const query = await searchParams;
  // Preserve all keys and duplicate arrays for strict validation; do not normalize away forgeries.
  const result = await readVenueStatus(actor, query, createVenueStatusStore(prisma), () => new Date());
  return <main className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
    <h1 className="text-2xl font-bold">Venue status</h1>
    <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 font-medium">Prototype — sample data. Not official university records.</p>
    <p>Calculated from the current published weekly timetable and recorded venue unavailability. Not a sensor reading or a booking guarantee.</p>
    {!result.ok ? <section role="alert" className="space-y-3 rounded-lg border border-red-300 p-4">
      <h2 className="text-lg font-semibold">Venue status unavailable</h2>
      <p>{result.message}</p>
      {query.semester === "1" || query.semester === "2" ? <p>Selected semester: {query.semester}.</p> : null}
      <p><a className="underline" href="/venues/status?semester=1&mode=live">Return to live semester 1</a>{" · "}
        <a className="underline" href="/venues/status?semester=2&mode=live">View live semester 2</a></p>
    </section> : <>
      <section aria-label="Publication and clock" className="space-y-2 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Semester {result.semester} · current published weekly timetable</h2>
        <p className="break-words">Version: {result.publication.id}; published {result.publication.publishedAt}.</p>
        <p role="status" aria-live="polite">{result.mode === "demo" ? "Simulated time — not live" : "Live schedule clock"}: {result.asOf.day} {result.asOf.time} EAT (Africa/Nairobi).</p>
        {result.outsideHours && <p>Outside assumed Mon–Fri 08:00–17:00 teaching hours. This weekly prototype is not an academic calendar.</p>}
      </section>
      <VenueStatusControls semester={result.semester} mode={result.mode} asOf={result.asOf} canDemo={canUseVenueDemoClock(actor)} />
      {result.integrityCount !== undefined && result.integrityCount > 0 &&
        <p role="alert">Published-data integrity warning: {result.integrityCount} overlapping booking/closure pairs on this day. Ask an officer to review the published timetable.</p>}
      {result.rows.length === 0 ? <p>No venues registered. Ask an officer to review the venue register.</p> :
        <ul aria-label="Schedule-derived venue statuses" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.rows.map((row) => <li key={row.code} className="min-w-0 space-y-2 break-words rounded-lg border border-slate-300 bg-white p-4">
            <h2 className="text-lg font-semibold">{row.code} <span className="text-sm font-normal">({row.type})</span></h2>
            <p className="font-semibold">{LABELS[row.status]}</p>
            <Timing row={row} />
          </li>)}
        </ul>}
    </>}
  </main>;
}
