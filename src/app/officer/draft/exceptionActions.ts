"use server";
import { prisma } from "@/server/db";
import { m6ActionActor } from "@/server/m6ActionAuth";
import { m6Result } from "@/server/m6Errors";
import { repairDraftException } from "@/server/draftExceptionRepair";
export async function repairDraftExceptionAction(input: unknown) {
    const auth = await m6Result(m6ActionActor);
    if (!auth.ok)
        return auth;
    return repairDraftException(prisma, auth.value, input, new Date());
}
