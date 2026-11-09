"use client";
import React from "react";
import { FlowStatus } from "@/components/FlowStatus";
export default function DataError({ reset }: {
    reset: () => void;
}) {
    return <main className="mx-auto max-w-4xl p-4"><FlowStatus state="ERROR">Data unavailable. Retry or ask the demo operator to check the database. No successful write is confirmed on this screen. <button className="underline" onClick={reset}>Retry</button></FlowStatus></main>;
}
