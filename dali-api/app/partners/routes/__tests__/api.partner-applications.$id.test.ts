import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })),
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/feature-flags.server");
vi.mock("~/partners/lib/partner-email.server");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getPartnerContactEmailThreads } from "~/partners/lib/partner-email.server";
import { loader } from "~/partners/routes/api.partner-applications.$id";

const db = prisma as unknown as Record<string, any>;
const APP_ID = "app-1";

function callLoader() {
  const request = new Request(`http://localhost/api/partner-applications/${APP_ID}`);
  return loader({ request, params: { id: APP_ID }, context: {} } as any);
}

const baseApplication = {
  id: APP_ID,
  title: "Gallery kiosk",
  summary: "A kiosk for the gallery.",
  stage: "Interview",
  sowDocId: null,
  sowState: "Draft",
  resultingProjectId: null,
  source: "Form",
  evalRubric: null,
  interviewRating: null,
  nextStep: "Send contract",
  nextStepDueAt: null,
  holdUntil: null,
  fundingType: null,
  feeCents: null,
  legalEntityName: null,
  legalEntityAddress: null,
  paymentSchedule: null,
  contractBindingId: null,
  decisionReason: null,
  rejectReason: null,
  partnerOrg: null,
  applicantContact: { id: "contact-1", name: "Ada Lovelace", email: "ada@acme.com" },
  targetTerms: [],
  domains: [],
  formSubmission: null,
  meetings: [],
  meetingRequests: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as any).mockResolvedValue({
    ok: true,
    user: { sub: "core-1", type: "member", email: "c@dali" },
  });
  (isCore as any).mockResolvedValue(true);
  (getUserRoles as any).mockResolvedValue({ isCore: true });
  (isFeatureEnabled as any).mockResolvedValue(false);
  (getPartnerContactEmailThreads as any).mockResolvedValue([]);
  db.partnerApplication.findUnique.mockResolvedValue(baseApplication);
  db.partnerActivity.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
});

describe("GET /api/partner-applications/:id — guards", () => {
  it("rejects non-Core callers", async () => {
    (isCore as any).mockResolvedValue(false);
    const res = (await callLoader()) as Response;
    expect(res.status).toBe(403);
  });

  it("404s on a missing application", async () => {
    db.partnerApplication.findUnique.mockResolvedValue(null);
    const res = (await callLoader()) as Response;
    expect(res.status).toBe(404);
  });
});

describe("GET /api/partner-applications/:id — payload", () => {
  it("returns the application, empty activity, and no email threads when the flag is off", async () => {
    const res = (await callLoader()) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.application.id).toBe(APP_ID);
    expect(body.application.nextStep).toBe("Send contract");
    expect(body.formAnswers).toEqual([]);
    expect(body.activities).toEqual([]);
    expect(body.emailThreads).toEqual([]);
    expect(body.partnerEmailOn).toBe(false);
    expect(getPartnerContactEmailThreads).not.toHaveBeenCalled();
  });

  it("loads email threads for the applicant contact when partner-email is on", async () => {
    (isFeatureEnabled as any).mockResolvedValue(true);
    (getPartnerContactEmailThreads as any).mockResolvedValue([
      { indexId: "m1", subject: "Hi", firstAt: "2026-01-01", lastAt: "2026-01-01", messageCount: 1, inbound: 1, outbound: 0 },
    ]);
    const res = (await callLoader()) as Response;
    const body = await res.json();
    expect(body.emailThreads).toHaveLength(1);
    expect(getPartnerContactEmailThreads).toHaveBeenCalledWith("contact-1");
  });

  it("maps a meeting's linked ScheduledMeeting onto startTime/meetingUrl", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      ...baseApplication,
      meetings: [
        {
          id: "meet-1",
          scheduledAt: new Date("2026-02-01T12:00:00Z"),
          attendeeUserIds: [],
          notes: null,
          debrief: null,
          outcome: null,
          scheduledMeeting: {
            id: "sm-1",
            selectedAt: new Date("2026-02-01T15:00:00Z"),
            meetingUrl: "https://meet.example/abc",
          },
        },
      ],
    });
    const res = (await callLoader()) as Response;
    const body = await res.json();
    expect(body.application.meetings[0].scheduledMeeting).toEqual({
      id: "sm-1",
      startTime: "2026-02-01T15:00:00.000Z",
      meetingUrl: "https://meet.example/abc",
    });
  });
});
