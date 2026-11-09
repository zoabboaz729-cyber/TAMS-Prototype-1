export const ATTENDANCE_MESSAGES = {
  UNAUTHENTICATED: "Sign in before using attendance.", FORBIDDEN: "This attendance resource is not available to your account. Return to your own class list.",
  INVALID_INPUT: "Check the class selection and code, then try again.", INVALID_STORED_DATA: "Stored class information is inconsistent. Ask the timetabling officer to review it.",
  NOT_FOUND: "This class or session is unavailable. Refresh your class list.", STALE_PUBLICATION: "The timetable changed. Refresh and use the current published class.",
  TERM_NOT_CONFIGURED: "This semester has no configured date window. Ask the officer to configure it.", OCCURRENCE_NOT_EFFECTIVE: "This dated class is not scheduled here. Check the moved class date.",
  NOT_IN_OPEN_WINDOW: "This action is available only during the scheduled class interval (Africa/Nairobi).", VENUE_UNAVAILABLE: "The assigned venue is unavailable. Report the discrepancy to the timetabling officer.",
  ALREADY_RECORDED: "Attendance was already recorded for your account. View your own history.", NOT_OPEN: "Attendance is closed. Ask your lecturer for guidance.",
  TOO_EARLY: "The scanning window has not started. Wait for the displayed start time.", EXPIRED: "The code or scanning window expired. Scan the latest code if attendance is still open.",
  INVALID_CODE: "The code is invalid or refreshed. Enter or scan the current lecturer code.", RATE_LIMITED: "Too many invalid codes. Wait five minutes before trying again.",
  CLASS_REPORTED_ENDED: "Class end was reported. Scanning has stopped; the lecturer can close attendance separately.", NOT_STARTED: "No class start was reported. Start the class before reporting its end.",
  ALREADY_STARTED: "Class start was already reported. Refresh to see its status.", ALREADY_ENDED: "Class end was already reported. It cannot be restarted.",
  RETRYABLE: "Another request is updating attendance. Refresh or retry; check your history before resubmitting.", CONFIGURATION: "Attendance configuration is unavailable. Ask the operator to check the server settings.",
  INTERNAL_ERROR: "Attendance could not be completed. Check your history and try again; contact the operator if it persists.",
} as const;
export type AttendanceErrorCode = keyof typeof ATTENDANCE_MESSAGES;
export type AttendanceResult<T> = { ok: true; value: T } | { ok: false; code: AttendanceErrorCode; message: string };
export class AttendanceError extends Error { constructor(public code: AttendanceErrorCode) { super(code); } }
export function refuse(code: AttendanceErrorCode): never { throw new AttendanceError(code); }
export async function attendanceResult<T>(fn: () => Promise<T>): Promise<AttendanceResult<T>> {
  try { return { ok: true, value: await fn() }; } catch (e) {
    const prismaCode = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "";
    const code = e instanceof AttendanceError ? e.code : ["P2002", "P2034", "P1008", "P2028"].includes(prismaCode) ? "RETRYABLE" : "INTERNAL_ERROR";
    return { ok: false, code, message: ATTENDANCE_MESSAGES[code] };
  }
}
