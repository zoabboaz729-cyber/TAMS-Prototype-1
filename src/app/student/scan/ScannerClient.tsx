"use client";
import React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { cameraLifecycle } from "./cameraLifecycle";
import { sendAttendance } from "./attendanceSubmission";
type Session = {
    id: string;
    unit: string;
    venue: string;
    date: string;
    start: string;
    end: string;
    scanFrom: string;
    closesAt: string;
    recorded: boolean;
    simulated: boolean;
};
/** STUB: opaque local ID for demo visualization; no fingerprinting or identity guarantee. */
export function deviceStub(): string | undefined {
    try {
        const key = "tams-device-stub-v1", stored = localStorage.getItem(key);
        if (stored && /^[a-zA-Z0-9-]{8,100}$/.test(stored))
            return stored;
        const id = crypto.randomUUID();
        localStorage.setItem(key, id);
        return id;
    }
    catch {
        return undefined;
    }
}
export default function ScannerClient({ sessions }: {
    sessions: Session[];
}) {
    const cameraId = `camera-${useId().replaceAll(":", "")}`, camera = useRef<ReturnType<typeof cameraLifecycle> | null>(null), mounted = useRef(true), inFlight = useRef(false);
    const [sessionId, setSessionId] = useState(sessions.find(s => !s.recorded)?.id ?? ""), [code, setCode] = useState(""), [message, setMessage] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [cameraOn, setCameraOn] = useState(false);
    async function stopCamera() { await camera.current?.stop(); }
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; void camera.current?.dispose(); camera.current = null; }; }, []);
    async function submit(payload: {
        method: "QR";
        token: string;
    } | {
        method: "CODE";
        sessionId: string;
        code: string;
    }) {
        if (inFlight.current)
            return;
        inFlight.current = true;
        setBusy(true);
        setConfirmed(false);
        setMessage("Submitting — waiting for server confirmation…");
        try {
            const outcome = await sendAttendance({ ...payload, deviceId: deviceStub() });
            if (!mounted.current)
                return;
            setConfirmed(outcome.kind === "CONFIRMED");
            setMessage(outcome.message);
            if (outcome.kind === "CONFIRMED") {
                setCode("");
                await stopCamera();
            }
        }
        finally {
            inFlight.current = false;
            if (mounted.current)
                setBusy(false);
        }
    }
    async function startCamera() {
        if (!camera.current)
            camera.current = cameraLifecycle(async () => {
                if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
                    throw new Error("secure-context");
                const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
                const s = new Html5Qrcode(cameraId, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
                return { get isScanning() { return s.isScanning; }, start: async (callback) => { await s.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 240 } }, callback, () => { }); }, stop: () => s.stop(), clear: () => s.clear() };
            }, text => submit({ method: "QR", token: text }), setCameraOn, () => setMessage("Camera unavailable, permission denied, or this page lacks HTTPS/localhost access. Use the typed-code form below, or grant permission and try again."));
        await camera.current.start();
    }
    return <section className="space-y-5"><div className="space-y-3 rounded border p-4"><h2 className="text-lg font-semibold">Scan lecturer QR</h2><button className="rounded border px-3 py-2 disabled:opacity-40" disabled={cameraOn || busy} onClick={() => void startCamera()}>Start camera</button>{" "}<button className="rounded border px-3 py-2" disabled={!cameraOn} onClick={() => void stopCamera()}>Stop camera</button><div id={cameraId} className="max-w-md"/><p>Camera access requires HTTPS or localhost and permission. Camera frames stay in your browser.</p></div>
 <form className="space-y-3 rounded border p-4" onSubmit={e => { e.preventDefault(); void submit({ method: "CODE", sessionId, code }); }}><h2 className="text-lg font-semibold">Enter lecturer code instead</h2><label className="block">Your group’s open class <select className="block w-full rounded border p-2" value={sessionId} onChange={e => setSessionId(e.target.value)} required><option value="">Choose a class</option>{sessions.filter(s => !s.recorded).map(s => <option value={s.id} key={s.id}>{s.unit} · {s.venue} · {s.date} {s.start}–{s.end}{s.simulated ? " · SIMULATED" : ""}</option>)}</select></label><label className="block">12-character code <input className="block w-full rounded border p-2 font-mono" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={14} required/></label><p>Enter ABCD-EFGH-JKLM format or twelve ungrouped characters. Rotating codes change every 30 seconds; use the latest displayed code.</p><button className="rounded border px-3 py-2 disabled:opacity-40" disabled={busy || !sessionId}>Submit attendance</button></form>
 <p role="status" aria-live="polite" className={confirmed ? "rounded border border-green-600 p-3" : "rounded border p-3"}>{message}</p><p><a className="underline" href="/reports/attendance">Check your own attendance history</a></p><p>Device binding STUB: a random local device ID may be stored. It is not reliable device identification or proof of presence.</p>
 </section>;
}
