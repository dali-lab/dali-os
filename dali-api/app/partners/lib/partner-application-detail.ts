// Client-safe shape for GET /api/partner-applications/:id — the data
// PartnerApplicationModal and its tabs render. Kept separate from the route
// file so every app/partners/components/application/*.tsx can import the
// type without pulling in server-only code (prisma, etc.).

import type { PartnerStage, PartnerRejectReason } from "./partner-application";

export type ApplicationDetail = {
  id: string;
  title: string;
  summary: string | null;
  stage: PartnerStage;
  sowDocId: string | null;
  sowState: "Draft" | "Shared" | "Accepted";
  resultingProjectId: string | null;
  source: string;
  evalRubric: unknown;
  interviewRating: number | null;
  nextStep: string | null;
  nextStepDueAt: string | null;
  holdUntil: string | null;
  fundingType: string | null;
  feeCents: number | null;
  legalEntityName: string | null;
  legalEntityAddress: string | null;
  paymentSchedule: string | null;
  contractBindingId: string | null;
  decisionReason: string | null;
  rejectReason: PartnerRejectReason | null;
  partner: { id: string; name: string; logoUrl: string | null } | null;
  applicant: { id: string; name: string; email: string };
  targetTerms: { id: string; code: string }[];
  domains: {
    id: string;
    domainId: string;
    domainName: string;
    expectedMembers: number;
    expectedChallenges: unknown;
  }[];
  meetings: {
    id: string;
    scheduledAt: string;
    attendeeUserIds: string[];
    notes: string | null;
    debrief: string | null;
    outcome: string | null;
    scheduledMeeting: { id: string; startTime: string | null; meetingUrl: string | null } | null;
  }[];
  meetingRequests: {
    id: string;
    startTime: string;
    durationMinutes: number;
    note: string | null;
    status: string;
    responseNote: string | null;
    createdAt: string;
  }[];
};

export type ApplicationActivity = {
  id: string;
  createdAt: string;
  applicationId: string | null;
  actorUserId: string | null;
  type: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
};

export type ApplicationEmailThread = {
  indexId: string;
  subject: string;
  firstAt: string;
  lastAt: string;
  messageCount: number;
  inbound: number;
  outbound: number;
};

export type ApplicationDetailResponse = {
  application: ApplicationDetail;
  formAnswers: { key: string; label: string; value: string }[];
  activities: ApplicationActivity[];
  actorNames: Record<string, string>;
  emailThreads: ApplicationEmailThread[];
  partnerEmailOn: boolean;
};
