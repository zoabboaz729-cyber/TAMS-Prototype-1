import React from "react";
import { requireAnyAction } from "@/server/guards";
import { prisma } from "@/server/db";
import { studentAttendanceList } from "@/server/attendanceReads";
import { attendanceRuntime } from "@/server/attendanceRuntime";
import { attendanceTransport } from "@/server/attendanceHttp";
import ScannerClient from "./ScannerClient";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function StudentScanPage() {
    const user = await requireAnyAction("SCAN_ATTENDANCE");
    const r = await attendanceTransport(async () => studentAttendanceList(prisma, user, attendanceRuntime()));
    return <main className="mx-auto max-w-3xl space-y-5 p-4"><h1 className="text-2xl font-bold">Record your attendance</h1><p>Prototype — sample data. Not official university records.</p><p>A scan is confirmed only after the server stores your mark. QR codes do not independently verify physical presence.</p>{!r.ok ? <p role="alert">{r.message}</p> : <>{r.value.some(s => s.simulated) && <p className="font-bold">SYNTHETIC SIMULATION — not live attendance.</p>}{r.value.length === 0 && <p>No open attendance session is available for your group. Refresh when your lecturer opens attendance.</p>}{r.value.filter(s => s.recorded).map(s => <p key={s.id}>Your stored attendance exists for {s.unit} ({s.date}). View your history for the receipt.</p>)}<ScannerClient sessions={r.value}/></>}</main>;
}
