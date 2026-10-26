/**
 * Pure deterministic seed data for Kisii University TAMS prototype.
 * Conforms to PROTOTYPE_SPEC §6 & §10.
 * Pure data only - no database calls.
 * All IDs are fixed deterministic strings.
 */

export interface SeedDepartment {
  id: string;
  name: string;
  schoolId: string;
}

export interface SeedVenue {
  id: string;
  code: string;
  type: "HALL" | "ROOM" | "LAB";
  capacity: number;
  ownerDepartmentId: string | null;
  facilities: string[];
  status: "ACTIVE" | "INACTIVE" | "MAINTENANCE";
}

export interface SeedVenueUnavailable {
  id: string;
  venueId: string;
  day: "MON" | "TUE" | "WED" | "THU" | "FRI";
  start: string;
  end: string;
  reason: string;
}

export interface SeedStudentGroup {
  id: string;
  name: string;
  size: number;
  departmentId: string;
}

export interface SeedUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "OFFICER" | "DEPT_REP" | "APPROVER" | "LECTURER" | "STUDENT";
  departmentId: string | null;
  studentGroupId: string | null;
}

export interface SeedLecturer {
  id: string;
  userId: string;
  departmentId: string;
}

export interface SeedLecturerAvailability {
  id: string;
  lecturerId: string;
  day: "MON" | "TUE" | "WED" | "THU" | "FRI";
  start: string;
  end: string;
  available: boolean;
}

export interface SeedUnit {
  id: string;
  code: string;
  title: string;
  departmentId: string;
  semester: number;
  hoursPerWeek: number;
  venueTypeRequired: "HALL" | "ROOM" | "LAB";
  scheduled: boolean;
}

export interface SeedTeaching {
  id: string;
  unitId: string;
  lecturerId: string;
  groupId: string;
  expectedSize: number;
  sessionsPerWeek: number;
  sessionLength: number;
}

export interface SeedSubmission {
  id: string;
  departmentId: string;
  semester: number;
  status: "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED";
  reviewerId: string | null;
  note: string | null;
}

export interface SeedIssue {
  id: string;
  departmentId: string;
  venueId: string | null;
  reportedBy: string | null;
  text: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
}

export interface SeedTimetableVersion {
  id: string;
  semester: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  createdBy: string;
}

export interface SeedTimetableEntry {
  id: string;
  versionId: string;
  teachingId: string;
  venueId: string;
  day: "MON" | "TUE" | "WED" | "THU" | "FRI";
  start: string;
  end: string;
  locked: boolean;
}

export const seedDepartments: SeedDepartment[] = [
  { id: "dept-computing", name: "Computing", schoolId: "SIST" },
  { id: "dept-mathematics", name: "Mathematics", schoolId: "SPAS" },
  { id: "dept-humanities", name: "Humanities", schoolId: "SHSS" },
];

export const seedVenues: SeedVenue[] = [
  { id: "venue-LH1", code: "LH1", type: "HALL", capacity: 150, ownerDepartmentId: "dept-computing", facilities: ["projector"], status: "ACTIVE" },
  { id: "venue-LH2", code: "LH2", type: "HALL", capacity: 100, ownerDepartmentId: "dept-mathematics", facilities: ["projector"], status: "ACTIVE" },
  { id: "venue-CR1", code: "CR1", type: "ROOM", capacity: 60, ownerDepartmentId: "dept-computing", facilities: [], status: "ACTIVE" },
  { id: "venue-CR2", code: "CR2", type: "ROOM", capacity: 50, ownerDepartmentId: "dept-computing", facilities: [], status: "ACTIVE" },
  { id: "venue-CR3", code: "CR3", type: "ROOM", capacity: 40, ownerDepartmentId: "dept-mathematics", facilities: [], status: "ACTIVE" },
  { id: "venue-LAB1", code: "LAB1", type: "LAB", capacity: 40, ownerDepartmentId: "dept-computing", facilities: ["computers", "projector"], status: "ACTIVE" },
  { id: "venue-LAB2", code: "LAB2", type: "LAB", capacity: 30, ownerDepartmentId: "dept-computing", facilities: ["computers"], status: "ACTIVE" },
  { id: "venue-GR1", code: "GR1", type: "ROOM", capacity: 80, ownerDepartmentId: null, facilities: [], status: "ACTIVE" },
  { id: "venue-GR2", code: "GR2", type: "ROOM", capacity: 40, ownerDepartmentId: null, facilities: [], status: "ACTIVE" },
];

export const seedVenueUnavailabilities: SeedVenueUnavailable[] = [
  { id: "vu-LH1-1", venueId: "venue-LH1", day: "FRI", start: "14:00", end: "17:00", reason: "Sample maintenance" },
  { id: "vu-LAB2-1", venueId: "venue-LAB2", day: "WED", start: "08:00", end: "12:00", reason: "Sample lab setup" },
];

export const seedStudentGroups: SeedStudentGroup[] = [
  { id: "group-SE-Y4", name: "SE-Y4", size: 45, departmentId: "dept-computing" },
  { id: "group-CS-Y2", name: "CS-Y2", size: 50, departmentId: "dept-computing" },
  { id: "group-SE-Y1", name: "SE-Y1", size: 60, departmentId: "dept-computing" },
];

export const seedUsers: SeedUser[] = [
  { id: "user-admin", name: "System Admin (sample)", email: "admin@demo.tams.test", role: "ADMIN", departmentId: null, studentGroupId: null },
  { id: "user-officer", name: "Timetabling Officer (sample)", email: "officer@demo.tams.test", role: "OFFICER", departmentId: null, studentGroupId: null },
  { id: "user-deptrep-computing", name: "Computing Dept Rep (sample)", email: "deptrep.computing@demo.tams.test", role: "DEPT_REP", departmentId: "dept-computing", studentGroupId: null },
  { id: "user-deptrep-maths", name: "Mathematics Dept Rep (sample)", email: "deptrep.maths@demo.tams.test", role: "DEPT_REP", departmentId: "dept-mathematics", studentGroupId: null },
  { id: "user-approver-computing", name: "Computing Approver (sample)", email: "approver.computing@demo.tams.test", role: "APPROVER", departmentId: "dept-computing", studentGroupId: null },
  { id: "user-lecturer-a", name: "Lecturer A", email: "lecturer.a@demo.tams.test", role: "LECTURER", departmentId: "dept-computing", studentGroupId: null },
  { id: "user-lecturer-b", name: "Lecturer B", email: "lecturer.b@demo.tams.test", role: "LECTURER", departmentId: "dept-computing", studentGroupId: null },
  { id: "user-lecturer-c", name: "Lecturer C", email: "lecturer.c@demo.tams.test", role: "LECTURER", departmentId: "dept-computing", studentGroupId: null },
  { id: "user-lecturer-d", name: "Lecturer D", email: "lecturer.d@demo.tams.test", role: "LECTURER", departmentId: "dept-computing", studentGroupId: null },
  { id: "user-lecturer-e", name: "Lecturer E", email: "lecturer.e@demo.tams.test", role: "LECTURER", departmentId: "dept-mathematics", studentGroupId: null },
  { id: "user-lecturer-f", name: "Lecturer F", email: "lecturer.f@demo.tams.test", role: "LECTURER", departmentId: "dept-mathematics", studentGroupId: null },
  { id: "user-student-1", name: "Student 1", email: "student1@demo.tams.test", role: "STUDENT", departmentId: "dept-computing", studentGroupId: "group-SE-Y4" },
  { id: "user-student-2", name: "Student 2", email: "student2@demo.tams.test", role: "STUDENT", departmentId: "dept-computing", studentGroupId: "group-SE-Y4" },
  { id: "user-student-3", name: "Student 3", email: "student3@demo.tams.test", role: "STUDENT", departmentId: "dept-computing", studentGroupId: "group-SE-Y4" },
  { id: "user-student-4", name: "Student 4", email: "student4@demo.tams.test", role: "STUDENT", departmentId: "dept-computing", studentGroupId: "group-SE-Y4" },
  { id: "user-student-5", name: "Student 5", email: "student5@demo.tams.test", role: "STUDENT", departmentId: "dept-computing", studentGroupId: "group-SE-Y4" },
];

export const seedLecturers: SeedLecturer[] = [
  { id: "lecturer-A", userId: "user-lecturer-a", departmentId: "dept-computing" },
  { id: "lecturer-B", userId: "user-lecturer-b", departmentId: "dept-computing" },
  { id: "lecturer-C", userId: "user-lecturer-c", departmentId: "dept-computing" },
  { id: "lecturer-D", userId: "user-lecturer-d", departmentId: "dept-computing" },
  { id: "lecturer-E", userId: "user-lecturer-e", departmentId: "dept-mathematics" },
  { id: "lecturer-F", userId: "user-lecturer-f", departmentId: "dept-mathematics" },
];

export const seedLecturerAvailabilities: SeedLecturerAvailability[] = [
  { id: "la-A-1", lecturerId: "lecturer-A", day: "MON", start: "08:00", end: "10:00", available: false },
  { id: "la-B-1", lecturerId: "lecturer-B", day: "FRI", start: "14:00", end: "17:00", available: false },
  { id: "la-C-1", lecturerId: "lecturer-C", day: "TUE", start: "08:00", end: "09:00", available: false },
  { id: "la-E-1", lecturerId: "lecturer-E", day: "WED", start: "14:00", end: "17:00", available: false },
];

export const seedUnits: SeedUnit[] = [
  // Semester 1 Real SE units
  { id: "unit-SOEN413", code: "SOEN 413", title: "Software Architecture", departmentId: "dept-computing", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-SOEN415", code: "SOEN 415", title: "Interactive Design & Software Project Management", departmentId: "dept-computing", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-SOEN410", code: "SOEN 410", title: "Software Process, Testing & Reliability", departmentId: "dept-computing", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-SOEN426", code: "SOEN 426", title: "Human Computer Interaction", departmentId: "dept-computing", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-SOEN412", code: "SOEN 412", title: "Professional Practices & Ethics", departmentId: "dept-computing", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-SOEN400", code: "SOEN 400", title: "Data Mining & Analytics", departmentId: "dept-computing", semester: 1, hoursPerWeek: 3, venueTypeRequired: "LAB", scheduled: true },
  { id: "unit-SOEN321", code: "SOEN 321", title: "Professional Attachment", departmentId: "dept-computing", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: false },
  // Semester 2 Real SE units
  { id: "unit-SOEN407", code: "SOEN 407", title: "Digital Image Processing", departmentId: "dept-computing", semester: 2, hoursPerWeek: 3, venueTypeRequired: "LAB", scheduled: true },
  { id: "unit-SOEN425", code: "SOEN 425", title: "Performance Engineering of Software Systems", departmentId: "dept-computing", semester: 2, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-SOEN421", code: "SOEN 421", title: "Systems Project", departmentId: "dept-computing", semester: 2, hoursPerWeek: 3, venueTypeRequired: "LAB", scheduled: true },
  { id: "unit-SOEN424", code: "SOEN 424", title: "Systems Auditing & Quality Assurance", departmentId: "dept-computing", semester: 2, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-SOEN490", code: "SOEN 490", title: "Number Theory & Cryptography", departmentId: "dept-computing", semester: 2, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-SOEN456", code: "SOEN 456", title: "Software Metrics", departmentId: "dept-computing", semester: 2, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  // CS-Y2 Synthetic Units
  { id: "unit-CS201", code: "DEMO-CS201", title: "Data Structures & Algorithms (sample)", departmentId: "dept-computing", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-CS202", code: "DEMO-CS202", title: "Database Systems (sample)", departmentId: "dept-computing", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-CS203", code: "DEMO-CS203", title: "Computer Networks (sample)", departmentId: "dept-computing", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-CS204", code: "DEMO-CS204", title: "Operating Systems (sample)", departmentId: "dept-computing", semester: 2, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-CS205", code: "DEMO-CS205", title: "Web Development (sample)", departmentId: "dept-computing", semester: 2, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-CS206", code: "DEMO-CS206", title: "Object Oriented Analysis (sample)", departmentId: "dept-computing", semester: 2, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  // SE-Y1 Synthetic Units
  { id: "unit-SE101", code: "DEMO-SE101", title: "Introduction to Programming (sample)", departmentId: "dept-computing", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-SE102", code: "DEMO-SE102", title: "Computer Systems Fundamentals (sample)", departmentId: "dept-computing", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-SE103", code: "DEMO-SE103", title: "Discrete Mathematics for SE (sample)", departmentId: "dept-computing", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-SE104", code: "DEMO-SE104", title: "Structured Programming (sample)", departmentId: "dept-computing", semester: 2, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-SE105", code: "DEMO-SE105", title: "Information Systems (sample)", departmentId: "dept-computing", semester: 2, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-SE106", code: "DEMO-SE106", title: "Communication Skills for SE (sample)", departmentId: "dept-computing", semester: 2, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  // Mathematics Shared Synthetic Units
  { id: "unit-MAT101", code: "DEMO-MAT101", title: "Calculus I (sample)", departmentId: "dept-mathematics", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-MAT102", code: "DEMO-MAT102", title: "Linear Algebra (sample)", departmentId: "dept-mathematics", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
  { id: "unit-MAT103", code: "DEMO-MAT103", title: "Probability & Statistics (sample)", departmentId: "dept-mathematics", semester: 1, hoursPerWeek: 3, venueTypeRequired: "ROOM", scheduled: true },
];

// Sessions per week = 3, session length = 1 hr (proxy for ASSUMPTION-15 until meeting)
export const seedTeachings: SeedTeaching[] = [
  // SE-Y4 (expectedSize 45)
  { id: "teach-SE-Y4-SOEN413", unitId: "unit-SOEN413", lecturerId: "lecturer-A", groupId: "group-SE-Y4", expectedSize: 45, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y4-SOEN415", unitId: "unit-SOEN415", lecturerId: "lecturer-B", groupId: "group-SE-Y4", expectedSize: 45, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y4-SOEN410", unitId: "unit-SOEN410", lecturerId: "lecturer-C", groupId: "group-SE-Y4", expectedSize: 45, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y4-SOEN426", unitId: "unit-SOEN426", lecturerId: "lecturer-D", groupId: "group-SE-Y4", expectedSize: 45, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y4-SOEN412", unitId: "unit-SOEN412", lecturerId: "lecturer-A", groupId: "group-SE-Y4", expectedSize: 45, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y4-SOEN400", unitId: "unit-SOEN400", lecturerId: "lecturer-B", groupId: "group-SE-Y4", expectedSize: 45, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y4-SOEN407", unitId: "unit-SOEN407", lecturerId: "lecturer-C", groupId: "group-SE-Y4", expectedSize: 45, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y4-SOEN425", unitId: "unit-SOEN425", lecturerId: "lecturer-D", groupId: "group-SE-Y4", expectedSize: 45, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y4-SOEN421", unitId: "unit-SOEN421", lecturerId: "lecturer-A", groupId: "group-SE-Y4", expectedSize: 45, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y4-SOEN424", unitId: "unit-SOEN424", lecturerId: "lecturer-B", groupId: "group-SE-Y4", expectedSize: 45, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y4-SOEN490", unitId: "unit-SOEN490", lecturerId: "lecturer-C", groupId: "group-SE-Y4", expectedSize: 45, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y4-SOEN456", unitId: "unit-SOEN456", lecturerId: "lecturer-D", groupId: "group-SE-Y4", expectedSize: 45, sessionsPerWeek: 3, sessionLength: 1 },
  // CS-Y2 (expectedSize 50)
  { id: "teach-CS-Y2-CS201", unitId: "unit-CS201", lecturerId: "lecturer-A", groupId: "group-CS-Y2", expectedSize: 50, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-CS-Y2-CS202", unitId: "unit-CS202", lecturerId: "lecturer-C", groupId: "group-CS-Y2", expectedSize: 50, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-CS-Y2-CS203", unitId: "unit-CS203", lecturerId: "lecturer-E", groupId: "group-CS-Y2", expectedSize: 50, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-CS-Y2-CS204", unitId: "unit-CS204", lecturerId: "lecturer-A", groupId: "group-CS-Y2", expectedSize: 50, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-CS-Y2-CS205", unitId: "unit-CS205", lecturerId: "lecturer-C", groupId: "group-CS-Y2", expectedSize: 50, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-CS-Y2-CS206", unitId: "unit-CS206", lecturerId: "lecturer-E", groupId: "group-CS-Y2", expectedSize: 50, sessionsPerWeek: 3, sessionLength: 1 },
  // SE-Y1 (expectedSize 60)
  { id: "teach-SE-Y1-SE101", unitId: "unit-SE101", lecturerId: "lecturer-B", groupId: "group-SE-Y1", expectedSize: 60, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y1-SE102", unitId: "unit-SE102", lecturerId: "lecturer-D", groupId: "group-SE-Y1", expectedSize: 60, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y1-SE103", unitId: "unit-SE103", lecturerId: "lecturer-F", groupId: "group-SE-Y1", expectedSize: 60, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y1-SE104", unitId: "unit-SE104", lecturerId: "lecturer-B", groupId: "group-SE-Y1", expectedSize: 60, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y1-SE105", unitId: "unit-SE105", lecturerId: "lecturer-D", groupId: "group-SE-Y1", expectedSize: 60, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y1-SE106", unitId: "unit-SE106", lecturerId: "lecturer-F", groupId: "group-SE-Y1", expectedSize: 60, sessionsPerWeek: 3, sessionLength: 1 },
  // Mathematics Service Units (Shared)
  { id: "teach-CS-Y2-MAT101", unitId: "unit-MAT101", lecturerId: "lecturer-E", groupId: "group-CS-Y2", expectedSize: 50, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y1-MAT101", unitId: "unit-MAT101", lecturerId: "lecturer-E", groupId: "group-SE-Y1", expectedSize: 60, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-CS-Y2-MAT102", unitId: "unit-MAT102", lecturerId: "lecturer-F", groupId: "group-CS-Y2", expectedSize: 50, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y1-MAT102", unitId: "unit-MAT102", lecturerId: "lecturer-F", groupId: "group-SE-Y1", expectedSize: 60, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-CS-Y2-MAT103", unitId: "unit-MAT103", lecturerId: "lecturer-C", groupId: "group-CS-Y2", expectedSize: 50, sessionsPerWeek: 3, sessionLength: 1 },
  { id: "teach-SE-Y1-MAT103", unitId: "unit-MAT103", lecturerId: "lecturer-C", groupId: "group-SE-Y1", expectedSize: 60, sessionsPerWeek: 3, sessionLength: 1 },
];

export const seedSubmissions: SeedSubmission[] = [
  { id: "sub-computing-s1", departmentId: "dept-computing", semester: 1, status: "DRAFT", reviewerId: null, note: "Draft submission for Semester 1 (sample)" },
  { id: "sub-maths-s1", departmentId: "dept-mathematics", semester: 1, status: "SUBMITTED", reviewerId: null, note: "Submitted math service units for Semester 1 (sample)" },
];

export const seedIssues: SeedIssue[] = [
  { id: "issue-cr1-projector", departmentId: "dept-computing", venueId: "venue-CR1", reportedBy: "user-deptrep-computing", text: "Projector in CR1 not working (sample)", status: "OPEN" },
];

export const seedTimetableVersions: SeedTimetableVersion[] = [
  { id: "ver-s1-planted", semester: 1, status: "DRAFT", createdBy: "user-officer" },
];

export const seedTimetableEntries: SeedTimetableEntry[] = [
  // Planted Venue Clash: CR1, MON 08:00-09:00
  { id: "entry-planted-venue-1", versionId: "ver-s1-planted", teachingId: "teach-SE-Y4-SOEN413", venueId: "venue-CR1", day: "MON", start: "08:00", end: "09:00", locked: false },
  { id: "entry-planted-venue-2", versionId: "ver-s1-planted", teachingId: "teach-SE-Y1-SE101", venueId: "venue-CR1", day: "MON", start: "08:00", end: "09:00", locked: false },
  // Planted Lecturer Clash: Lecturer A, TUE 10:00-11:00
  { id: "entry-planted-lecturer-1", versionId: "ver-s1-planted", teachingId: "teach-SE-Y4-SOEN412", venueId: "venue-CR2", day: "TUE", start: "10:00", end: "11:00", locked: false },
  { id: "entry-planted-lecturer-2", versionId: "ver-s1-planted", teachingId: "teach-CS-Y2-CS201", venueId: "venue-CR3", day: "TUE", start: "10:00", end: "11:00", locked: false },
  // 6 Clean entries violating no hard or soft constraints
  { id: "entry-clean-1", versionId: "ver-s1-planted", teachingId: "teach-SE-Y4-SOEN415", venueId: "venue-CR1", day: "WED", start: "09:00", end: "10:00", locked: false },
  { id: "entry-clean-2", versionId: "ver-s1-planted", teachingId: "teach-SE-Y4-SOEN410", venueId: "venue-CR1", day: "THU", start: "10:00", end: "11:00", locked: false },
  { id: "entry-clean-3", versionId: "ver-s1-planted", teachingId: "teach-SE-Y4-SOEN426", venueId: "venue-CR2", day: "MON", start: "14:00", end: "15:00", locked: false },
  { id: "entry-clean-4", versionId: "ver-s1-planted", teachingId: "teach-CS-Y2-CS202", venueId: "venue-CR1", day: "FRI", start: "10:00", end: "11:00", locked: false },
  { id: "entry-clean-5", versionId: "ver-s1-planted", teachingId: "teach-CS-Y2-CS203", venueId: "venue-GR1", day: "THU", start: "14:00", end: "15:00", locked: false },
  { id: "entry-clean-6", versionId: "ver-s1-planted", teachingId: "teach-SE-Y1-SE102", venueId: "venue-GR1", day: "TUE", start: "14:00", end: "15:00", locked: false },
];
