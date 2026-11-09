/** Deterministic server-only credentials; no identities in the signed wire format. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AttendanceMode } from "@/domain/attendanceRules";
const Payload = z.object({ typ: z.literal("TAMS_ATTENDANCE_V1"), sid: z.string().min(1).max(150), gen: z.number().int().nonnegative(), mode: AttendanceMode, bucket: z.number().int().nonnegative().nullable(), expMs: z.number().int().positive() }).strict();
export type TokenContext = {
    id: string;
    tokenGeneration: number;
    mode: string;
    closesAt: Date;
};
const mac = (s: string, key: string) => createHmac("sha256", key).update(s).digest();
export function attendanceSecret(env: Record<string, string | undefined> = process.env): string {
    const secret = env.ATTENDANCE_TOKEN_SECRET;
    if (!secret || Buffer.byteLength(secret) < 32 || secret === env.SESSION_SECRET || /replace|placeholder|example/i.test(secret))
        throw new Error("CONFIGURATION");
    return secret;
}
export function tokenPayload(source: TokenContext, nowMs: number) {
    const mode = AttendanceMode.parse(source.mode), bucket = mode === "ROTATING" ? Math.floor(nowMs / 30000) : null;
    return Payload.parse({ typ: "TAMS_ATTENDANCE_V1", sid: source.id, gen: source.tokenGeneration, mode, bucket, expMs: Math.min(source.closesAt.getTime(), bucket === null ? Infinity : (bucket + 1) * 30000) });
}
export function signAttendanceToken(source: TokenContext, secret: string, nowMs: number): string {
    const data = Buffer.from(JSON.stringify(tokenPayload(source, nowMs))).toString("base64url");
    const signed = `tams1.${data}`;
    return `${signed}.${mac(signed, secret).toString("base64url")}`;
}
export function authenticateAttendanceToken(input: unknown, secret: string) {
    if (typeof input !== "string" || input.length > 1024 || !/^tams1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(input))
        return null;
    try {
        const [, data, sig] = input.split("."), signature = Buffer.from(sig, "base64url"), expected = mac(`tams1.${data}`, secret);
        if (signature.length !== expected.length || signature.toString("base64url") !== sig || !timingSafeEqual(signature, expected))
            return null;
        const decoded = Buffer.from(data, "base64url");
        if (decoded.toString("base64url") !== data)
            return null;
        const p = Payload.parse(JSON.parse(decoded.toString("utf8")));
        if (p.mode === "STATIC" && p.bucket !== null) return null;
        if (p.mode === "ROTATING" && p.bucket === null) return null;
        if (Buffer.from(JSON.stringify(p)).toString("base64url") !== data)
            return null;
        return p;
    }
    catch {
        return null;
    }
}
export function verifyAttendanceToken(input: unknown,secret:string,nowMs:number){
 const p=authenticateAttendanceToken(input,secret);
 if(!p||!Number.isFinite(nowMs)||nowMs>=p.expMs||(p.mode==="ROTATING"&&p.bucket!==Math.floor(nowMs/30000)))return null;
 return p;
}
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 unambiguous Base32 symbols.
export function typedAttendanceCode(source: TokenContext, secret: string, nowMs: number): string {
    const p = tokenPayload(source, nowMs);
    let n = BigInt(`0x${mac(`TAMS_TYPED_V1:${JSON.stringify(p)}`, secret).subarray(0, 10).toString("hex")}`), code = "";
    for (let i = 0; i < 12; i++) {
        code += alphabet[Number(n % BigInt(alphabet.length))];
        n /= BigInt(alphabet.length);
    }
    return code;
}
export function normalizeAttendanceCode(code: string): string | null {
    if (!/^(?:[A-HJ-NP-Z2-9]{12}|[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})$/i.test(code))
        return null;
    return code.replaceAll("-", "").toUpperCase();
}
export function verifyTypedCode(input: string, source: TokenContext, secret: string, nowMs: number): boolean {
    const code = normalizeAttendanceCode(input);
    if (!code || nowMs >= source.closesAt.getTime())
        return false;
    return timingSafeEqual(Buffer.from(code), Buffer.from(typedAttendanceCode(source, secret, nowMs)));
}
