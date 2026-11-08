"use server";
import { prisma } from "@/server/db";
import { m6ActionActor } from "@/server/m6ActionAuth";
import { m6Result } from "@/server/m6Errors";
import { createIssue, updateIssue } from "@/server/issueService";
export async function createIssueAction(input: unknown) {
    const auth = await m6Result(m6ActionActor);
    if (!auth.ok)
        return auth;
    return createIssue(prisma, auth.value, input);
}
export async function updateIssueAction(input: unknown) {
    const auth = await m6Result(m6ActionActor);
    if (!auth.ok)
        return auth;
    return updateIssue(prisma, auth.value, input);
}
