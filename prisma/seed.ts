import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/server/password";
import {
  seedDepartments,
  seedVenues,
  seedVenueUnavailabilities,
  seedStudentGroups,
  seedUsers,
  seedLecturers,
  seedLecturerAvailabilities,
  seedUnits,
  seedTeachings,
  seedSubmissions,
  seedIssues,
  seedTimetableVersions,
  seedTimetableEntries,
} from "../src/domain/seedData";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "Seeding is disabled in production environment. Aborting without modifying database."
    );
    process.exit(1);
  }

  // Load .env if DEMO_PASSWORD is not already present in environment
  if (!process.env.DEMO_PASSWORD && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile();
    } catch {
      // .env not present or inaccessible; handled by check below
    }
  }

  const demoPassword = process.env.DEMO_PASSWORD;
  if (!demoPassword || demoPassword.trim().length === 0) {
    console.error(
      "Error: DEMO_PASSWORD environment variable is missing. Set DEMO_PASSWORD in .env or your environment."
    );
    process.exit(1);
  }

  // Hash password for demo accounts using scrypt
  const passwordHash = await hashPassword(demoPassword);

  await prisma.$transaction(async tx => {
    // Lock before checking, so concurrent capture cannot slip between check and deletion.
    await tx.$executeRawUnsafe('UPDATE "AssumptionFeedback" SET "id" = "id" WHERE 0');
    if (await tx.assumptionFeedback.count() !== 0) throw new Error("Seed refused: meeting findings exist. Use the guarded demo reset to preserve findings and capture audits.");
  // 1. Wipe all tables in reverse dependency order
  await tx.attendanceAttempt.deleteMany();
  await tx.classOccurrenceActivity.deleteMany();
  await tx.attendanceRecord.deleteMany();
  await tx.attendanceSession.deleteMany();
  await tx.rescheduleRequest.deleteMany();
  await tx.timetableOccurrenceException.deleteMany();
  await tx.timetableEntry.deleteMany();
  await tx.timetableVersion.updateMany({data:{basePublishedVersionId:null}});
  await tx.timetableVersion.deleteMany();
  await tx.issue.deleteMany();
  await tx.submission.deleteMany();
  await tx.teaching.deleteMany();
  await tx.lecturerAvailability.deleteMany();
  await tx.lecturer.deleteMany();
  await tx.unit.deleteMany();
  await tx.venueUnavailable.deleteMany();
  await tx.venue.deleteMany();
  await tx.auditLog.deleteMany();
  await tx.assumptionFeedback.deleteMany();
  await tx.user.deleteMany();
  await tx.studentGroup.deleteMany();
  await tx.department.deleteMany();

  // 2. Insert seed records in dependency order
  await tx.department.createMany({
    data: seedDepartments,
  });

  await tx.studentGroup.createMany({
    data: seedStudentGroups,
  });

  await tx.user.createMany({
    data: seedUsers.map((user) => ({
      ...user,
      passwordHash,
    })),
  });

  await tx.venue.createMany({
    data: seedVenues.map((venue) => ({
      ...venue,
      facilities: JSON.stringify(venue.facilities),
    })),
  });

  await tx.venueUnavailable.createMany({
    data: seedVenueUnavailabilities,
  });

  await tx.lecturer.createMany({
    data: seedLecturers,
  });

  await tx.lecturerAvailability.createMany({
    data: seedLecturerAvailabilities,
  });

  await tx.unit.createMany({
    data: seedUnits,
  });

  await tx.teaching.createMany({
    data: seedTeachings,
  });

  await tx.submission.createMany({
    data: seedSubmissions,
  });

  await tx.issue.createMany({
    data: seedIssues,
  });

  await tx.timetableVersion.createMany({
    data: seedTimetableVersions,
  });

  await tx.timetableEntry.createMany({
    data: seedTimetableEntries,
  });

  }, {timeout:20000});

  // 3. Print row counts per table
  const counts = {
    departments: await prisma.department.count(),
    studentGroups: await prisma.studentGroup.count(),
    users: await prisma.user.count(),
    venues: await prisma.venue.count(),
    venueUnavailabilities: await prisma.venueUnavailable.count(),
    lecturers: await prisma.lecturer.count(),
    lecturerAvailabilities: await prisma.lecturerAvailability.count(),
    units: await prisma.unit.count(),
    teachings: await prisma.teaching.count(),
    submissions: await prisma.submission.count(),
    issues: await prisma.issue.count(),
    timetableVersions: await prisma.timetableVersion.count(),
    timetableEntries: await prisma.timetableEntry.count(),
  };

  console.log("Database seeded successfully. Row counts per table:");
  for (const [table, count] of Object.entries(counts)) {
    console.log(`- ${table}: ${count}`);
  }
}

main()
  .catch((e) => {
    console.error("Seeding failed with error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
