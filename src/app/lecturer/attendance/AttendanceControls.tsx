"use client";
import React from "react";
import type { AttendanceResult } from "@/server/attendanceErrors";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openAttendanceAction, closeAttendanceAction, startClassAction, endClassAction } from "./actions";
export default function AttendanceControls({ sourceEntryId, originalDate, sessionId, activity, inWindow, realStartAllowed, sessionStatus }: {
    sourceEntryId: string;
    originalDate: string;
    sessionId: string | null;
    activity: string | null;
    inWindow: boolean;
    realStartAllowed: boolean;
    sessionStatus: string;
}) {
    const [mode, setMode] = useState("ROTATING"), [confirmed, setConfirmed] = useState(false), [message, setMessage] = useState(""), [pending, startTransition] = useTransition();
    const router = useRouter();
    const ref = { sourceEntryId, originalDate };
    function run(action: () => Promise<AttendanceResult<unknown>>) { startTransition(async () => { setMessage("Waiting for server confirmation…"); try {
        const r = await action();
        setMessage(r.ok ? "Server confirmed. Status refreshed." : r.message);
        if (r.ok)
            router.refresh();
    }
    catch {
        setMessage("The outcome is unknown because the response was lost. Refresh the status before retrying.");
    } }); }
    return <div className="space-y-3 rounded border p-3">
  <fieldset disabled={pending} className="space-y-3"><legend className="font-semibold">Report class activity</legend>
   <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/> I am reporting that teaching has started for this class at the scheduled venue; this is not independently location-verified.</label>
   <button className="rounded border px-3 py-2 disabled:opacity-40" disabled={!confirmed || !realStartAllowed || activity !== null} onClick={() => run(() => startClassAction({ ...ref, confirmVenue: true }))}>Start class</button>{" "}
   <button className="rounded border px-3 py-2 disabled:opacity-40" disabled={activity !== "REPORTED_STARTED"} onClick={() => run(() => endClassAction(ref))}>End class</button>
   {!realStartAllowed && <p>Start reporting is available only during the actual scheduled class time, using the real server clock.</p>}
  </fieldset>
  <fieldset disabled={pending} className="space-y-3"><legend className="font-semibold">QR attendance (independent)</legend>
   <label>Code mode <select value={mode} onChange={e => setMode(e.target.value)} className="rounded border p-2"><option value="ROTATING">Rotating every 30 seconds</option><option value="STATIC">Static until close</option></select></label>{" "}
   <button className="rounded border px-3 py-2 disabled:opacity-40" disabled={!inWindow || !!sessionId} onClick={() => run(() => openAttendanceAction({ ...ref, mode }))}>Open attendance</button>{" "}
   <button className="rounded border px-3 py-2 disabled:opacity-40" disabled={!sessionId || !["OPEN", "EXPIRED"].includes(sessionStatus)} onClick={() => run(() => closeAttendanceAction({ sessionId: sessionId! }))}>Close attendance</button>
  </fieldset><p role="status" aria-live="polite">{message}</p>
 </div>;
}
