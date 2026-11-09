/** Read-only evidence, never physical occupancy or booking authority. */
export function venueActivityLabel(reservation: string, activity: string | null, attendance: string, count: number): string {
    if (reservation === "UNAVAILABLE")
        return "Unavailable · Operational closure";
    if (reservation === "FREE")
        return "Free (schedule-derived); physical occupancy not verified";
    if (reservation === "UPCOMING")
        return "Upcoming scheduled booking";
    if (reservation !== "OCCUPIED")
        throw new Error("INVALID_STORED_DATA");
    if (activity === "REPORTED_ENDED")
        return `Reserved until scheduled end · Class end reported${attendance === "OPEN" ? "; QR needs closing" : ""}`;
    if (activity === "REPORTED_STARTED")
        return `Reserved · In use (lecturer-reported)${attendance === "OPEN" ? "; QR open" : ""}`;
    if (activity !== null)
        throw new Error("INVALID_STORED_DATA");
    if (count > 0)
        return "Reserved · Attendance recorded; class start unconfirmed";
    return attendance === "OPEN" ? "Reserved · Attendance open; class start unconfirmed" : "Reserved — class start not reported";
}
