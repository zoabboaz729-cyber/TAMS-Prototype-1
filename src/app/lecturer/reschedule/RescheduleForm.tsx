"use client";
import { useState } from "react";
import M6Form from "@/components/M6Form";
import { submitRescheduleAction } from "./actions";
export default function RescheduleForm({ entries }: { entries: { id: string; label: string }[] }) {
  const [kind,setKind] = useState("WEEKLY");
  return <M6Form action={submitRescheduleAction} label="Submit request" fixed={{ kind }}>
    <label className="block">Published class <select required name="sourceEntryId">{entries.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</select></label>
    <label className="block">Change type <select value={kind} onChange={e => setKind(e.target.value)}><option value="WEEKLY">Recurring weekly</option><option value="ONE_OFF">One class on a date</option></select></label>
    {kind === "WEEKLY" ? <label className="block">New weekday <select name="proposedDay">{["MON","TUE","WED","THU","FRI"].map(d => <option key={d}>{d}</option>)}</select></label> : <>
      <label className="block">Original occurrence date <input type="date" name="originalDate" required /></label>
      <label className="block">Replacement date <input type="date" name="replacementDate" required /></label>
    </>}
    <label className="block">New start (EAT) <input required type="time" name="proposedStart" /></label>
    <label className="block">New end (EAT) <input required type="time" name="proposedEnd" /></label>
    <label className="block">Reason <textarea name="reason" required minLength={10} maxLength={500} className="block w-full border" /></label>
  </M6Form>;
}
