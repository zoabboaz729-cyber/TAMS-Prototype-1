import { prisma } from "./db";
import { Prisma } from "@prisma/client";
import type {
  VenueStore,
  StoredVenue,
  StoredVenueFields,
  AuditDraft,
} from "./venueWrite";

export function createPrismaVenueStore(): VenueStore {
  return {
    async findVenue(id: string): Promise<StoredVenue | null> {
      const v = await prisma.venue.findUnique({
        where: { id },
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
      if (v === null) return null;
      return {
        id: v.id,
        code: v.code,
        type: v.type,
        capacity: v.capacity,
        ownerDepartmentId: v.ownerDepartmentId,
        facilities: v.facilities,
        status: v.status,
      };
    },
    async findVenueByCode(code: string): Promise<{ id: string } | null> {
      const v = await prisma.venue.findUnique({
        where: { code },
        select: { id: true },
      });
      return v === null ? null : { id: v.id };
    },
    async departmentExists(id: string): Promise<boolean> {
      const d = await prisma.department.findUnique({
        where: { id },
        select: { id: true },
      });
      return d !== null;
    },
    async createVenue(fields, audit) {
      try {
        return await prisma.$transaction(async (tx) => {
          const v = await tx.venue.create({ data: fields });
          await tx.auditLog.create({
            data: {
              actorId: audit.actorId,
              action: audit.action,
              entity: "Venue",
              entityId: v.id,
              reason: audit.reason,
            },
          });
          return { id: v.id };
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          return { conflict: true };
        }
        throw e;
      }
    },
    async updateVenue(id, fields, audit) {
      try {
        return await prisma.$transaction(async (tx) => {
          const existing = await tx.venue.findUnique({
            where: { id },
            select: { id: true },
          });
          if (existing === null) return { notFound: true };
          await tx.venue.update({ where: { id }, data: fields });
          await tx.auditLog.create({
            data: {
              actorId: audit.actorId,
              action: audit.action,
              entity: "Venue",
              entityId: id,
              reason: audit.reason,
            },
          });
          return { ok: true };
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          return { conflict: true };
        }
        throw e;
      }
    },
  };
}