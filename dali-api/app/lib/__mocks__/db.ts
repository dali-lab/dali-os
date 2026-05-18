import { vi } from "vitest";

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
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  scheduledMeeting: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  instructorAssignment: {
    findFirst: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  educationOffering: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
  },
  educationApplication: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  },
  educationApplicationAnswer: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  educationApplicationQuestion: {
    findMany: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({ _max: { position: null } }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  educationSession: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    aggregate: vi.fn().mockResolvedValue({ _max: { sequence: null } }),
  },
  educationAssignment: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  educationSubmission: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  educationAttendance: {
    upsert: vi.fn(),
  },
  educationAnnouncement: {
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  },
  notificationEvent: {
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  page: {
    findMany: vi.fn().mockResolvedValue([]),
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
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  term: {
    findFirst: vi.fn().mockResolvedValue(null),
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
  $transaction: vi.fn(),
};
