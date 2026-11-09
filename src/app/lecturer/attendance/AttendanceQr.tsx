"use client";
import React from "react";
import { useEffect, useState } from "react";
import { z } from "zod";
const Credential = z.object({ image: z.string().startsWith("data:image/png;base64,"), code: z.string(), expiresAt: z.string(), scanFrom: z.string(), closesAt: z.string(), simulated: z.boolean() });
export default function AttendanceQr({ sessionId }: {
    sessionId: string;
}) {
    const [data, setData] = useState<z.infer<typeof Credential> | null>(null), [count, setCount] = useState<number | null>(null), [error, setError] = useState(""), [asOf, setAsOf] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        async function refresh() {
            try {
                const [qr, summary] = await Promise.all([fetch(`/api/attendance/sessions/${encodeURIComponent(sessionId)}/token`, { cache: "no-store", signal: controller.signal }), fetch(`/api/attendance/sessions/${encodeURIComponent(sessionId)}/summary`, { cache: "no-store", signal: controller.signal })]);
                const q: unknown = await qr.json(), s: unknown = await summary.json();
                const schema = z.object({ ok: z.literal(true), value: Credential }), parsed = schema.safeParse(q);
                if (!parsed.success) {
                    setData(null);
                    const failure = z.object({ message: z.string() }).safeParse(q);
                    setError(failure.success ? failure.data.message : "Code unavailable. Refresh the class status.");
                }
                else {
                    setData(parsed.data.value);
                    setError("");
                }
                const counted = z.object({ ok: z.literal(true), value: z.object({ count: z.number().int().nonnegative() }) }).safeParse(s);
                if (!counted.success)
                    throw new Error();
                setCount(counted.data.value.count);
                setAsOf(new Date().toLocaleTimeString());
            }
            catch {
                if (!controller.signal.aborted) {
                    setData(null);
                    setError("Connection lost. Code hidden; count below is last known. Refresh to check the server.");
                }
            }
            if (!controller.signal.aborted)
                timer = setTimeout(refresh, 2000);
        }
        void refresh();
        return () => { controller.abort(); clearTimeout(timer); };
    }, [sessionId]);
    return <section aria-label="Attendance credential" className="space-y-2 rounded border p-3"><p>Confirmed stored marks: {count ?? "unavailable"}{asOf && ` · last checked ${asOf}`}</p>
 {error && <p role="alert">{error}</p>}{data && <>{data.simulated && <p className="font-bold">Synthetic simulation — not live attendance</p>}
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img src={data.image} width={320} height={320} alt="Current attendance QR. Students can use the typed code below instead."/>
 <p>Typed code: <strong className="break-all font-mono text-xl">{data.code.match(/.{1,4}/g)?.join("-")}</strong></p><p>Code expires: {data.expiresAt}. Scan window: {data.scanFrom} to {data.closesAt} (UTC instants).</p><p>Codes may be shared; QR does not independently prove physical presence.</p></>}
 </section>;
}
