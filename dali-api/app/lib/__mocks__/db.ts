import { vi } from "vitest";

export const prisma = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  refreshToken: {
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
  },
  application: {
    findUnique: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  partyEvent: {
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  cycleConfidentialityAgreement: {
    findUnique: vi.fn().mockResolvedValue({ confidentialityAgreementVersionId: "mock-cav-id" }),
  },
  confidentialityAgreementSignature: {
    findUnique: vi.fn().mockResolvedValue({ confidentialityAgreementVersionId: "mock-cav-id" }),
  },
  $transaction: vi.fn(),
};
