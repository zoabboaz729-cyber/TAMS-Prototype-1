"use server";
import { prisma } from "@/server/db";
import { attendanceActionActor, attendanceTransport } from "@/server/attendanceHttp";
import { attendanceRuntime } from "@/server/attendanceRuntime";
import { openAttendance, closeAttendance } from "@/server/attendanceService";
import { reportClassActivity } from "@/server/classActivity";
export async function openAttendanceAction(input: unknown) { return attendanceTransport(async () => { const actor = await attendanceActionActor(); return openAttendance(prisma, actor, input, attendanceRuntime()); }); }
export async function closeAttendanceAction(input: unknown) { return attendanceTransport(async () => { const actor = await attendanceActionActor(); return closeAttendance(prisma, actor, input, attendanceRuntime()); }); }
export async function startClassAction(input: unknown) { return attendanceTransport(async () => { const actor = await attendanceActionActor(); return reportClassActivity(prisma, actor, input, "START", () => new Date()); }); }
export async function endClassAction(input: unknown) { return attendanceTransport(async () => { const actor = await attendanceActionActor(); return reportClassActivity(prisma, actor, input, "END", () => new Date()); }); }
