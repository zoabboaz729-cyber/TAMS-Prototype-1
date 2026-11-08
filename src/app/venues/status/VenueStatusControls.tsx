"use client";
/** Only clock/public presentation props cross this boundary; no raw schedules. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { VENUE_CLOCK_DAYS, type VenueClock } from "@/domain/venueStatus";
export type VenueStatusControlsProps = {
  semester: number; mode: "live" | "demo"; asOf: VenueClock; canDemo: boolean;
};
const control = "w-full rounded-md border border-slate-400 p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600";
const button = "rounded-md bg-indigo-700 px-4 py-2 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700";
export default function VenueStatusControls({ semester, mode, asOf, canDemo }: VenueStatusControlsProps) {
  const router = useRouter();
  useEffect(() => {
    if (mode !== "live") return;
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refreshWhenVisible); };
  }, [mode, router]);
  return <section aria-label="Venue clock controls" className="space-y-4">
    <form method="get" action="/venues/status" aria-label="Live semester selector" className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
      <input type="hidden" name="mode" value="live" />
      <div className="min-w-0 flex-1">
        <label htmlFor="venue-live-semester">Semester (selected manually)</label>
        <select id="venue-live-semester" name="semester" defaultValue={String(semester)} className={control}>
          <option value="1">Semester 1</option><option value="2">Semester 2</option>
        </select>
      </div>
      <button type="submit" className={button}>{mode === "demo" ? "Reset to live" : "Show live status"}</button>
    </form>
    <p>{mode === "live" ? "Live status refreshes from the server roughly every minute while visible, and when you return to this tab." : "Simulated time — not live. Apply a new day/time to update this view."}</p>
    {canDemo && <form method="get" action="/venues/status" aria-label="Simulated venue clock" className="rounded-lg border border-amber-400 bg-amber-50 p-4" key={`${semester}-${mode}-${asOf.day}-${asOf.time}`}>
      <fieldset className="space-y-3">
        <legend className="font-semibold">Simulated clock (officer/admin demonstration)</legend>
        <p>This changes only this view. It does not change the published timetable, stored data or system clock.</p>
        <input type="hidden" name="mode" value="demo" />
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label htmlFor="venue-demo-semester">Semester</label>
            <select id="venue-demo-semester" name="semester" defaultValue={String(semester)} className={control}>
              <option value="1">Semester 1</option><option value="2">Semester 2</option>
            </select></div>
          <div><label htmlFor="venue-demo-day">Weekday</label>
            <select id="venue-demo-day" name="day" defaultValue={asOf.day} className={control}>
              {VENUE_CLOCK_DAYS.map((day) => <option key={day} value={day}>{day}</option>)}
            </select></div>
          <div><label htmlFor="venue-demo-time">Time (24-hour HH:MM, EAT)</label>
            <input id="venue-demo-time" type="time" name="time" defaultValue={asOf.time} required step="60" className={control} /></div>
        </div>
        <button type="submit" className={button}>Apply simulated time</button>
      </fieldset>
    </form>}
  </section>;
}
