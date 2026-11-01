/**
 * Server-only data access for the venue register (task M2-T1b3).
 *
 * Reads exactly the columns the register displays - nothing more - through
 * the shared Prisma client from src/server/db.ts.
 */
import { prisma } from "./db";
import type { DepartmentRef, VenueRecord } from "@/domain/venueRegister";

/**
 * Load venue records selecting exactly id, code, type, capacity,
 * ownerDepartmentId, facilities and status. No other fields.
 */
export async function loadVenueRecords(): Promise<VenueRecord[]> {
  return prisma.venue.findMany({
    select: {
      id: true,
      code: true,
      type: true,
      capacity: true,
      ownerDepartmentId: true,
      facilities: true,
      status: true,
    },
  });
}

/**
 * Load department reference data selecting id and name only. No other fields.
 */
export async function loadDepartments(): Promise<DepartmentRef[]> {
  return prisma.department.findMany({
    select: {
      id: true,
      name: true,
    },
  });
}