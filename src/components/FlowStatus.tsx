import React from "react";
export type FlowState = "READY" | "SAVED" | "EMPTY" | "NOT_READY" | "INVALID" | "ERROR" | "UNKNOWN" | "BLOCKED";
export function FlowStatus({ state, children, href, action }: {
    state: FlowState;
    children: React.ReactNode;
    href?: string;
    action?: string;
}) {
    return <div role={["ERROR", "INVALID", "UNKNOWN", "BLOCKED"].includes(state) ? "alert" : "status"} className="rounded border border-slate-300 bg-slate-50 p-3 break-words"><strong>{state.replaceAll("_", " ")}: </strong>{children}{href && <a href={href} className="ml-2 underline">{action ?? "Review setup"}</a>}</div>;
}
