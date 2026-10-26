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

  // 1. Wipe all tables in reverse dependency order
  await prisma.attendanceRecord.deleteMany();
  await prisma.attendanceSession.deleteMany();
  await prisma.rescheduleRequest.deleteMany();
  await prisma.timetableEntry.deleteMany();
  await prisma.timetableVersion.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.teaching.deleteMany();
  await prisma.lecturerAvailability.deleteMany();
  await prisma.lecturer.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.venueUnavailable.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.assumptionFeedback.deleteMany();
  await prisma.user.deleteMany();
  await prisma.studentGroup.deleteMany();
  await prisma.department.deleteMany();

  // 2. Insert seed records in dependency order
  await prisma.department.createMany({
    data: seedDepartments,
  });

  await prisma.studentGroup.createMany({
    data: seedStudentGroups,
  });

  await prisma.user.createMany({
    data: seedUsers.map((user) => ({
      ...user,
      passwordHash,
    })),
  });

  await prisma.venue.createMany({
    data: seedVenues.map((venue) => ({
      ...venue,
      facilities: JSON.stringify(venue.facilities),
    })),
  });

  await prisma.venueUnavailable.createMany({
    data: seedVenueUnavailabilities,
  });

  await prisma.lecturer.createMany({
    data: seedLecturers,
  });

  await prisma.lecturerAvailability.createMany({
    data: seedLecturerAvailabilities,
  });

  await prisma.unit.createMany({
    data: seedUnits,
  });

  await prisma.teaching.createMany({
    data: seedTeachings,
  });

  await prisma.submission.createMany({
    data: seedSubmissions,
  });

  await prisma.issue.createMany({
    data: seedIssues,
  });

  await prisma.timetableVersion.createMany({
    data: seedTimetableVersions,
  });

  await prisma.timetableEntry.createMany({
    data: seedTimetableEntries,
  });

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
