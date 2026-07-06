import { vi } from "vitest";

// Stub of the Prisma namespace re-exported from the real ~/lib/db. Only the
// JSON-null sentinels are referenced by callers (e.g. forms-data clearing a
// Json? column); they're identity-compared, so a stable stub object suffices.
export const Prisma = {
  DbNull: Symbol.for("Prisma.DbNull"),
  JsonNull: Symbol.for("Prisma.JsonNull"),
};

export const prisma = {
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  session: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  oAuthSession: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  interviewConfig: {
    findUnique: vi.fn(),
  },
  cycleReviewer: {
    findMany: vi.fn(),
  },
  interviewAssignment: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  interview: {
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  },
  application: {
    findUnique: vi.fn(),
  },
  applicationCycleStatusUpdate: {
    findFirst: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  confidentialityAgreement: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  cycleConfidentialityAgreement: {
    findUnique: vi.fn().mockResolvedValue({ confidentialityAgreementVersionId: "mock-cav-id" }),
  },
  confidentialityAgreementSignature: {
    findUnique: vi.fn().mockResolvedValue({ confidentialityAgreementVersionId: "mock-cav-id" }),
    count: vi.fn().mockResolvedValue(0),
  },
  oAuthClient: {
    findUnique: vi.fn(),
  },
  oAuthGrant: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  dALIMember: {
    findUnique: vi.fn(),
  },
  notification: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  projectAssignment: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
  },
  project: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  },
  sprint: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  epic: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  userStory: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  task: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  taskAssignee: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  taskComment: {
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  page: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
  },
  projectFile: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  scheduledMeeting: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  form: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  formVersion: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  formFolder: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  userAvailabilitySettings: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
  workingHoursDay: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  manualBlock: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  userCalendarLink: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  term: {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  },
  adminMembership: {
    findUnique: vi.fn(),
  },
  coreAssignment: {
    findFirst: vi.fn(),
  },
  domainLeadAssignment: {
    findFirst: vi.fn(),
  },
  instructorAssignment: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
};
