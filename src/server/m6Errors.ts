/** Fixed outward errors: never expose SQL or review snapshots. */
export const M6_CODES = ["UNAUTHENTICATED", "FORBIDDEN", "INVALID_INPUT", "IDENTITY_UNRESOLVED", "NO_PUBLICATION", "AMBIGUOUS_PUBLICATION", "SOURCE_NOT_FOUND", "LOCKED", "NO_CHANGE", "DUPLICATE_PENDING", "TERM_NOT_CONFIGURED", "DATE_OUT_OF_TERM", "PAST_OCCURRENCE", "ALREADY_OVERRIDDEN", "EXCEPTIONS_REQUIRE_REVIEW", "NOT_PENDING", "INCOMPLETE_VALIDATION", "CONFLICTS_REQUIRE_OVERRIDE", "NOTE_REQUIRED", "STALE", "STALE_SOURCE", "INVALID_STORED_DATA", "INTERNAL_ERROR", "NOT_DRAFT", "INVALID_TRANSITION"] as const;
export type M6Code = (typeof M6_CODES)[number];
export class M6Error extends Error {
    readonly code: M6Code;
    constructor(code: string) { super("M6 operation refused"); this.code = M6_CODES.includes(code as M6Code) ? code as M6Code : "INTERNAL_ERROR"; }
}
export function ensure(condition: unknown, code: string): asserts condition { if (!condition)
    throw new M6Error(code); }
export type M6Result<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    code: M6Code;
    message: string;
};
export async function m6Result<T>(run: () => Promise<T>): Promise<M6Result<T>> {
    try {
        return { ok: true, value: await run() };
    }
    catch (e) {
        const code = e instanceof M6Error ? e.code : e instanceof Error && M6_CODES.includes(e.message as M6Code) ? e.message as M6Code : typeof e === "object" && e !== null && "code" in e && e.code === "P2002" ? "DUPLICATE_PENDING" : "INTERNAL_ERROR";
        return { ok: false, code, message: `${code.replaceAll("_", " ")}. Refresh and check the selected source, dates and permissions; contact an officer if this persists.` };
    }
}
