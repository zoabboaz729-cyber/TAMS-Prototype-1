"use server";
import { prisma } from "@/server/db";
import { m6ActionActor } from "@/server/m6ActionAuth";
import { m6Result } from "@/server/m6Errors";
import { decideReschedule } from "@/server/rescheduleService";
export async function decideRescheduleAction(input: unknown) {
  const auth = await m6Result(m6ActionActor); if (!auth.ok) return auth;
  return decideReschedule(prisma,auth.value,input,new Date());
}
