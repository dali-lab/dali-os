import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/hiring/lib/confidentiality", () => ({ requirePageSignedOrRedirect: vi.fn() }));
vi.mock("~/education/lib/engagement.server", () => ({ getEducationEngagement: vi.fn() }));
vi.mock("~/hiring/lib/prior-applications.server", () => ({ listPriorApplications: vi.fn() }));
vi.mock("~/hiring/lib/email-engagement.server", () => ({ getApplicantEmailEngagement: vi.fn() }));
vi.mock("~/hiring/lib/hiring-events.server", () => ({ getHiringEventEngagement: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/collab/read", () => ({ readDocAsBlocks: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { requirePageSignedOrRedirect } from "~/hiring/lib/confidentiality";
import { getEducationEngagement } from "~/education/lib/engagement.server";
import { listPriorApplications } from "~/hiring/lib/prior-applications.server";
import { getApplicantEmailEngagement } from "~/hiring/lib/email-engagement.server";
import { getHiringEventEngagement } from "~/hiring/lib/hiring-events.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { readDocAsBlocks } from "~/collab/read";
import { loader } from "~/hiring/routes/applications.$domainApplicationId";

const mockPrisma = prisma as unknown as Record<string, any>;

const DA_ID = "da-1";
const APPLICATION_ID = "app-1";
const CYCLE_ID = "cycle-1";

function baseDa(overrides: { anonymizeReview: boolean }) {
  return {
    id: DA_ID,
    domainId: "domain-1",
    answers: {},
    interviewPrepNote: null,
    domain: { id: "domain-1", name: "Design", displayName: "Design" },
    challengeFormVersion: null,
    application: {
      id: APPLICATION_ID,
      answers: {},
      applicationCycleId: CYCLE_ID,
      applicationFormVersion: null,
      applicationCycle: {
        name: "Fall Cycle",
        applicants: "Students",
        timeline: null,
        hasChallenges: false,
        anonymizeReview: overrides.anonymizeReview,
        generalRubricVersion: null,
        domains: [],
      },
      statusUpdates: [{ newStatus: "Submitted", createdAt: new Date("2026-01-01") }],
      user: { id: "u-1", firstName: "Ada", lastName: "Lovelace" },
    },
  };
}

function callLoader() {
  return loader({
    request: new Request(`http://localhost/hiring/applications/${DA_ID}`),
    params: { domainApplicationId: DA_ID },
    context: {},
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "viewer-1", type: "user" } } as any);
  vi.mocked(getUserRoles).mockResolvedValue({ isAdmin: true, isCore: true, isDomainLead: false } as any);
  vi.mocked(requirePageSignedOrRedirect).mockResolvedValue(null as never);
  vi.mocked(getEducationEngagement).mockResolvedValue([] as never);
  vi.mocked(listPriorApplications).mockResolvedValue([] as never);
  vi.mocked(getApplicantEmailEngagement).mockResolvedValue(null as never);
  vi.mocked(getHiringEventEngagement).mockResolvedValue([] as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(false);
  vi.mocked(readDocAsBlocks).mockResolvedValue([]);

  mockPrisma.domainApplication = {
    findUnique: vi.fn().mockResolvedValue(baseDa({ anonymizeReview: true })),
    findMany: vi.fn().mockResolvedValue([{ id: DA_ID }]),
  };
  mockPrisma.domainLeadAssignment = { findFirst: vi.fn().mockResolvedValue(null) };
  mockPrisma.applicationReview = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.interview = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.decision = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.delibsSession = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.cycleReviewer = { findFirst: vi.fn().mockResolvedValue(null) };
  mockPrisma.application = { findMany: vi.fn().mockResolvedValue([{ id: APPLICATION_ID }]) };
});

describe("applications.$domainApplicationId loader — blind review", () => {
  it("blinds the applicant's name when the cycle anonymizes review and nothing is released", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(baseDa({ anonymizeReview: true }));
    mockPrisma.decision.findMany.mockResolvedValue([]); // nothing released

    const result: any = await callLoader();

    expect(result.blinded).toBe(true);
    expect(result.applicantName).toBe("Applicant 1");
  });

  it("passes blinded=true through to priorApplications and email engagement calls", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(baseDa({ anonymizeReview: true }));
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    vi.mocked(getApplicantEmailEngagement).mockResolvedValue({
      totals: { inbound: 0, outbound: 0, firstAt: null, lastAt: null },
      threads: [],
    } as never);

    await callLoader();

    expect(listPriorApplications).toHaveBeenCalledWith(
      expect.objectContaining({ hideOutcomes: true }),
    );
    expect(getApplicantEmailEngagement).toHaveBeenCalledWith("u-1", { blinded: true });
  });

  it("shows the real name once the domain's decision is released", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(baseDa({ anonymizeReview: true }));
    mockPrisma.decision.findMany.mockResolvedValue([
      {
        id: "dec-1",
        type: "Standard",
        stage: "Released",
        notes: null,
        waitlistRank: null,
        createdAt: new Date("2026-02-01"),
        madeBy: null,
        domainApplicationId: DA_ID,
      },
    ]);

    const result: any = await callLoader();

    expect(result.blinded).toBe(false);
    expect(result.applicantName).toBe("Ada Lovelace");
  });

  it("does not blind when the cycle has anonymizeReview off", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(baseDa({ anonymizeReview: false }));

    const result: any = await callLoader();

    expect(result.blinded).toBe(false);
    expect(result.applicantName).toBe("Ada Lovelace");
  });
});

describe("applications.$domainApplicationId loader — application events engagement", () => {
  it("defaults to an empty list and skips the lookup when the flag is off", async () => {
    const result: any = await callLoader();

    expect(getHiringEventEngagement).not.toHaveBeenCalled();
    expect(result.hiringEventEngagement).toEqual([]);
    expect(result.cycleId).toBe(CYCLE_ID);
  });

  it("fetches the applicant's event attendance when the flag is on", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    vi.mocked(getHiringEventEngagement).mockResolvedValue([
      {
        eventId: "evt-1",
        title: "Help hour",
        kind: "HelpHour",
        startsAt: new Date("2026-10-14T20:00:00.000Z"),
        endsAt: new Date("2026-10-14T21:00:00.000Z"),
        cycleId: CYCLE_ID,
        cycleName: "Fall Cycle",
      },
    ] as never);

    const result: any = await callLoader();

    expect(getHiringEventEngagement).toHaveBeenCalledWith("u-1");
    expect(result.hiringEventEngagement).toHaveLength(1);
  });
});

describe("applications.$domainApplicationId loader — interview rounds", () => {
  const iv = (id: string, interviewRoundId: string, interviewer: string) => ({
    id,
    startTime: new Date("2026-10-10T14:00:00Z"),
    endTime: new Date("2026-10-10T14:30:00Z"),
    status: "Completed",
    interviewRoundId,
    room: null,
    zoomJoinUrl: null,
    videoUrl: null,
    recommendation: null,
    recommendationNotes: null,
    assignments: [
      {
        id: `a-${id}`,
        role: "InDomain",
        cycleInterviewer: { userId: `u-${interviewer}`, user: { firstName: interviewer, lastName: "" }, domain: { name: "Design" } },
      },
    ],
  });

  it("gives each Interviews round its own section, in timeline order", async () => {
    const da = baseDa({ anonymizeReview: false });
    da.application.applicationCycle.timeline = [
      { kind: "phase", key: "setup", weeks: [1, 5] },
      { kind: "phase", key: "review", weeks: [6, 6] },
      { kind: "delib", id: "first", label: "First delib", weeks: [6, 6] },
      { kind: "phase", key: "interviews", weeks: [7, 7] },
      { kind: "delib", id: "r3", label: "Delib 3", weeks: [8, 8] },
      { kind: "phase", key: "interviews", id: "iv2", label: "Interviews 2", weeks: [9, 9] },
      { kind: "delib", id: "final", label: "Final delib", weeks: [10, 10] },
      { kind: "phase", key: "decisions", weeks: [11, 11] },
    ] as any;
    mockPrisma.domainApplication.findUnique.mockResolvedValue(da);
    mockPrisma.interview.findMany.mockResolvedValue([iv("i2", "iv2", "Grace"), iv("i1", "interviews", "Alan")]);
    mockPrisma.collabDocumentVersion = { findMany: vi.fn().mockResolvedValue([]) };

    const result: any = await callLoader();

    expect(result.interviewRounds).toEqual([
      { roundId: "interviews", label: "Interviews" },
      { roundId: "iv2", label: "Interviews 2" },
    ]);
    expect(result.interviews.map((i: any) => [i.id, i.interviewRoundId])).toEqual([
      ["i2", "iv2"],
      ["i1", "interviews"],
    ]);
  });

  it("hands the joint notes over as the doc's blocks, with the last snapshot's time", async () => {
    const blocks = [
      { id: "b1", type: "heading", props: { level: 2, isToggleable: true }, content: [{ type: "text", text: "Technical", styles: {} }], children: [] },
    ];
    mockPrisma.domainApplication.findUnique.mockResolvedValue(baseDa({ anonymizeReview: false }));
    mockPrisma.interview.findMany.mockResolvedValue([iv("i1", "interviews", "Alan")]);
    mockPrisma.collabDocumentVersion = {
      findMany: vi.fn().mockResolvedValue([
        { name: "interview:i1:notes", plainText: "Technical", createdAt: new Date("2026-10-10T15:00:00Z") },
      ]),
    };
    vi.mocked(readDocAsBlocks).mockImplementation(async (name: string) => (name === "interview:i1:notes" ? (blocks as any) : []));

    const result: any = await callLoader();

    expect(readDocAsBlocks).toHaveBeenCalledWith("interview:i1:notes");
    expect(result.interviews[0].jointNotes).toEqual({ blocks, updatedAt: "2026-10-10T15:00:00.000Z" });
  });

  it("gives an interview with no notes snapshot empty blocks and no edit time", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(baseDa({ anonymizeReview: false }));
    mockPrisma.interview.findMany.mockResolvedValue([iv("i1", "interviews", "Alan")]);
    mockPrisma.collabDocumentVersion = { findMany: vi.fn().mockResolvedValue([]) };

    const result: any = await callLoader();

    expect(result.interviews[0].jointNotes).toEqual({ blocks: [], updatedAt: null });
  });
});
