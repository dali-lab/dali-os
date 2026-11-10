import { describe, it, expect, beforeEach, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  domainLeadAssignment: { findMany: vi.fn() },
  applicationCycle: { findMany: vi.fn() },
  cycleDomainForm: { findMany: vi.fn() },
  interview: { findMany: vi.fn() },
  cycleReviewer: { findMany: vi.fn() },
  delibsSession: { findMany: vi.fn() },
  domainApplication: { count: vi.fn() },
  decision: { findMany: vi.fn() },
  rubricVersion: { findMany: vi.fn() },
  applicationReview: { findMany: vi.fn(), count: vi.fn() },
  cycleInterviewer: { findMany: vi.fn() },
  interviewConfig: { findUnique: vi.fn() },
  form: { findMany: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/hiring/lib/confidentiality", () => ({
  getCycleConfidentialityState: vi.fn(),
  confidentialityBlock: vi.fn(),
}));
vi.mock("~/hiring/lib/cycle-picker", () => ({
  selectActiveCycleForDomainLead: vi.fn((cycles: unknown[]) => cycles[0] ?? null),
}));
vi.mock("~/hiring/lib/cycle-stages.server", () => ({ delibsQualifier: vi.fn(async () => ({})) }));
vi.mock("~/hiring/lib/rubric-criteria", () => ({ buildCriteriaList: vi.fn() }));
vi.mock("~/hiring/lib/interview-availability.server", () => ({ interviewerCalendars: vi.fn() }));
vi.mock("~/hiring/lib/email-engagement.server", () => ({ getEngagementSummaries: vi.fn() }));
vi.mock("~/hiring/lib/application-form.server", () => ({
  addDomainChallenge: vi.fn(),
  removeDomainChallenge: vi.fn(),
}));
vi.mock("~/hiring/lib/domain-windows.server", () => ({ setDomainReady: vi.fn() }));
vi.mock("~/hiring/lib/cycle-rosters.server", () => ({
  addDomainMentors: vi.fn(),
  domainMentorIds: vi.fn(),
}));
vi.mock("~/lib/question-blocks.server", () => ({ normalizeQuestionBodies: vi.fn((q: unknown) => q) }));

import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { confidentialityBlock, getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { buildCriteriaList } from "~/hiring/lib/rubric-criteria";
import { interviewerCalendars } from "~/hiring/lib/interview-availability.server";
import { getEngagementSummaries } from "~/hiring/lib/email-engagement.server";
import { loader } from "~/hiring/routes/domain-lead";

const ROLES = { isCore: false, isDomainLead: true, isAdmin: false, isInterviewer: false };
const ASSIGNMENT = { id: "a1", userId: "u1", domainId: "d1", domain: { id: "d1" } };
const cycleRow = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "26F",
  timeline: null,
  hasInterviews: true,
  generalRubricVersionId: "gen",
  statusUpdates: [{ newStatus: "Open" }],
  domains: [{ domainId: "d1", rubricVersionId: "rv1", isReady: true }],
  applications: [
    {
      userId: "applicant1",
      statusUpdates: [{ newStatus: "Submitted" }],
      domainApplications: [
        { domainId: "d1", submittedAt: new Date(), selected: true, decisions: [], reviews: [], interviews: [] },
      ],
    },
  ],
  ...over,
});

const request = new Request("http://localhost/domain-lead");
const run = () => loader({ request } as never) as Promise<any>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(getUserRoles).mockResolvedValue(ROLES as never);
  vi.mocked(getCycleConfidentialityState).mockResolvedValue({} as never);
  vi.mocked(confidentialityBlock).mockReturnValue(null);
  vi.mocked(buildCriteriaList).mockResolvedValue([{ id: "crit" }] as never);
  vi.mocked(getEngagementSummaries).mockResolvedValue(new Map() as never);
  prisma.domainLeadAssignment.findMany.mockResolvedValue([ASSIGNMENT]);
  prisma.applicationCycle.findMany.mockResolvedValue([cycleRow()]);
  prisma.cycleDomainForm.findMany.mockResolvedValue([]);
  prisma.interview.findMany.mockResolvedValue([]);
  prisma.cycleReviewer.findMany.mockResolvedValue([]);
  prisma.delibsSession.findMany.mockResolvedValue([]);
  prisma.domainApplication.count.mockResolvedValue(0);
  prisma.decision.findMany.mockResolvedValue([{ id: "dec1" }]);
  prisma.rubricVersion.findMany.mockResolvedValue([{ id: "gen", criteria: [{ id: "g" }] }]);
  prisma.applicationReview.findMany.mockResolvedValue([{ rubricVersionId: "old" }]);
  prisma.applicationReview.count.mockResolvedValue(2);
  prisma.cycleInterviewer.findMany.mockResolvedValue([{ userId: "i1", user: { id: "i1" } }]);
  prisma.interviewConfig.findUnique.mockResolvedValue({ id: "cfg" });
  prisma.form.findMany.mockResolvedValue([{ id: "f1", name: "Form" }]);
  vi.mocked(interviewerCalendars).mockResolvedValue(
    new Map([
      ["i1", { hasCalendar: true, available: [{ startTime: new Date(0), endTime: new Date(2 * 3600_000) }] }],
    ]) as never,
  );
});

describe("domain lead loader", () => {
  it("returns an empty dashboard when the session is not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    expect(await run()).toEqual({ domainData: [], pillRoles: null });
    expect(prisma.domainLeadAssignment.findMany).not.toHaveBeenCalled();
  });

  it("returns only the pill roles for a user with no domain lead assignment", async () => {
    prisma.domainLeadAssignment.findMany.mockResolvedValue([]);
    expect(await run()).toEqual({ domainData: [], pillRoles: ROLES });
    expect(prisma.applicationCycle.findMany).not.toHaveBeenCalled();
    expect(prisma.form.findMany).not.toHaveBeenCalled();
  });

  it("passes the request to getUserRoles", async () => {
    await run();
    expect(getUserRoles).toHaveBeenCalledWith("u1", request);
  });

  it("loads the per-cycle reads and the Drive form list for the active cycle", async () => {
    const data = await run();
    const [entry] = data.domainData;
    expect(entry.draftDecisions).toEqual([{ id: "dec1" }]);
    expect(entry.hasApplicationReviews).toBe(true);
    expect(entry.rubricCriteria).toEqual([{ id: "crit" }]);
    expect(entry.confidentialityRequired).toBeNull();
    expect(entry.apps).toHaveLength(1);
    expect(data.allForms).toEqual([{ id: "f1", name: "Form" }]);
    expect(getEngagementSummaries).toHaveBeenCalledWith(["applicant1"]);
  });

  it("feeds the general rubric criteria and pinned review versions to buildCriteriaList", async () => {
    await run();
    expect(buildCriteriaList).toHaveBeenCalledWith({
      domainRubricVersionId: "rv1",
      generalCriteria: [{ id: "g" }],
      pinnedVersionIds: ["old"],
    });
  });

  it("sums each interviewer's free calendar hours from the first round's config", async () => {
    const [entry] = (await run()).domainData;
    expect(entry.interviewers).toMatchObject([{ userId: "i1", availabilityHours: 2, hasCalendar: true }]);
    expect(interviewerCalendars).toHaveBeenCalledWith(["i1"], { id: "cfg" });
  });

  it("skips the config and calendar reads when the cycle has no interviews", async () => {
    prisma.applicationCycle.findMany.mockResolvedValue([cycleRow({ hasInterviews: false })]);
    const [entry] = (await run()).domainData;
    expect(prisma.interviewConfig.findUnique).not.toHaveBeenCalled();
    expect(interviewerCalendars).not.toHaveBeenCalled();
    expect(entry.interviewers).toMatchObject([{ userId: "i1", availabilityHours: 0, hasCalendar: false }]);
  });

  it("reports no application reviews when the count is zero", async () => {
    prisma.applicationReview.count.mockResolvedValue(0);
    expect((await run()).domainData[0].hasApplicationReviews).toBe(false);
  });

  it("does not read interviews for a Draft cycle", async () => {
    prisma.applicationCycle.findMany.mockResolvedValue([cycleRow({ statusUpdates: [{ newStatus: "Draft" }] })]);
    await run();
    expect(prisma.interview.findMany).not.toHaveBeenCalled();
  });

  it("strips applicant data but keeps setup data when the confidentiality agreement is unsigned", async () => {
    vi.mocked(confidentialityBlock).mockReturnValue("unsigned");
    prisma.interview.findMany.mockResolvedValue([{ id: "iv1" }]);
    prisma.delibsSession.findMany.mockResolvedValue([{ id: "ds1" }]);
    const [entry] = (await run()).domainData;
    expect(entry.confidentialityRequired).toBe("unsigned");
    expect(entry.cycle.applications).toEqual([]);
    expect(entry.apps).toEqual([]);
    expect(entry.interviews).toEqual([]);
    expect(entry.draftDecisions).toEqual([]);
    expect(entry.delibsSessions).toEqual([]);
    expect(entry.delibRounds).toEqual([]);
    expect(entry.rubricCriteria).toEqual([{ id: "crit" }]);
    expect(entry.interviewers).toHaveLength(1);
  });

  it("returns a null cycle when the domain has no cycle to show", async () => {
    prisma.applicationCycle.findMany.mockResolvedValue([]);
    const [entry] = (await run()).domainData;
    expect(entry.cycle).toBeNull();
    expect(prisma.decision.findMany).not.toHaveBeenCalled();
  });
});
