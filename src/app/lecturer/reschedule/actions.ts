"use server";
import { prisma } from "@/server/db";
import { m6ActionActor } from "@/server/m6ActionAuth";
import { m6Result } from "@/server/m6Errors";
import { submitReschedule, cancelReschedule } from "@/server/rescheduleService";
export async function submitRescheduleAction(input: unknown) {
  const auth = await m6Result(m6ActionActor); if (!auth.ok) return auth;
  return submitReschedule(prisma,auth.value,input,new Date());
}
export async function cancelRescheduleAction(input: unknown) {
  const auth = await m6Result(m6ActionActor); if (!auth.ok) return auth;
  return cancelReschedule(prisma,auth.value,input);
}
