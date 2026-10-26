/**
 * Shared Prisma client for TAMS server.
 * Uses the globalThis pattern to avoid creating multiple clients during
 * Next.js hot-reload in development.
 */
import { PrismaClient } from "@prisma/client";

// Extend globalThis so TypeScript knows about the cached instance.
const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
