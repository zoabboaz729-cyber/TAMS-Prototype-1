import { realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { resetPolicy } from "@/domain/demoResetPolicy";
import type { Prisma } from "@prisma/client";
export async function resetTarget(env: Record<string, string | undefined>) {
    if (!resetPolicy(env))
        throw new Error("BLOCKED");
    const root = await realpath(path.resolve("prisma")), file = path.resolve("prisma", env.DATABASE_URL!.slice(5));
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || path.dirname(file) !== root || await realpath(file) !== file)
        throw new Error("BLOCKED");
    return file;
}
export async function assertConnectedTarget(tx: Prisma.TransactionClient, target: string) {
    const dbs = await tx.$queryRawUnsafe<{
        name: string;
        file: string;
    }[]>("PRAGMA database_list");
    const file = dbs.find(d => d.name === "main")?.file;
    if (!file || await realpath(file) !== target)
        throw new Error("BLOCKED");
}
