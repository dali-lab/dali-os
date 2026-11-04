import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    term: { findMany: vi.fn() },
    domain: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
    partnerApplication: { findMany: vi.fn() },
    staffingCycle: { findUnique: vi.fn() },
    user: { count: vi.fn() },
    intentToWork: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { currentTerm } from "~/lib/roles";
import { loadPlanningData } from "../planning-gap.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const TERMS = [
  { id: "t25f", code: "25F", sortKey: 1 },
  { id: "t26w", code: "26W", sortKey: 2 },
  { id: "t26s", code: "26S", sortKey: 3 },
  { id: "t26f", code: "26F", sortKey: 4 },
];

const ada = { id: "u-ada", firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" };

function project(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "Example Project",
    iconEmoji: null,
    status: "Active",
    description: null,
    projectTerms: [{ termId: "t26w", pi: ada }],
    termStatuses: [],
    roleRequests: [],
    partners: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.term.findMany.mockResolvedValue(TERMS);
  vi.mocked(currentTerm).mockResolvedValue(TERMS[2] as never);
  db.domain.findMany.mockResolvedValue([{ id: "eng", displayName: "Engineering" }]);
  db.project.findMany.mockResolvedValue([]);
  db.partnerApplication.findMany.mockResolvedValue([]);
  db.staffingCycle.findUnique.mockResolvedValue(null);
  db.user.count.mockResolvedValue(40);
  db.intentToWork.findMany.mockResolvedValue([]);
});

describe("loadPlanningData term selection", () => {
  it("returns an empty plan when there are no terms", async () => {
    db.term.findMany.mockResolvedValue([]);
    vi.mocked(currentTerm).mockResolvedValue(null);
    const data = await loadPlanningData(null);
    expect(data).toMatchObject({ termId: null, items: [], terms: [], intentSetup: { kind: "no-form" } });
    expect(db.project.findMany).not.toHaveBeenCalled();
  });

  it("plans for the term after the current one by default, newest term first in the picker", async () => {
    const data = await loadPlanningData(null);
    expect(data.termId).toBe("t26f");
    expect(data.terms.map((t) => t.code)).toEqual(["26F", "26S", "26W", "25F"]);
    expect(data.terms.find((t) => t.isCurrent)?.code).toBe("26S");
  });

  it("falls back to the current term when it is the last one", async () => {
    vi.mocked(currentTerm).mockResolvedValue(TERMS[3] as never);
    expect((await loadPlanningData(null)).termId).toBe("t26f");
  });

  it("honors a requested term and ignores an unknown one", async () => {
    expect((await loadPlanningData("t26w")).termId).toBe("t26w");
    expect((await loadPlanningData("nope")).termId).toBe("t26f");
  });

  it("scopes queries to the chosen term and the one before it", async () => {
    await loadPlanningData("t26s");
    expect(db.project.findMany.mock.calls[0][0].where).toEqual({
      projectTerms: { some: { term: { sortKey: { lte: 3 } } } },
    });
    expect(db.project.findMany.mock.calls[0][0].select.roleRequests.where).toEqual({
      termId: { in: ["t26s", "t26w"] },
    });
    expect(db.partnerApplication.findMany.mock.calls[0][0].where).toMatchObject({
      resultingProjectId: null,
      targetTerms: { some: { termId: "t26s" } },
    });
  });
});

describe("loadPlanningData projects", () => {
  it("sums a new project's role-request slots per domain in the chosen term", async () => {
    db.project.findMany.mockResolvedValue([
      project({
        projectTerms: [{ termId: "t26s", pi: ada }],
        roleRequests: [
          { termId: "t26s", domainId: "eng", slots: 2 },
          { termId: "t26s", domainId: "eng", slots: 1 },
        ],
      }),
    ]);
    const data = await loadPlanningData("t26s");
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      key: "project:p1",
      source: "new",
      state: "Accepted",
      spotsByDomain: { eng: 3 },
      piName: "Ada Lovelace",
    });
  });

  it("lists a project with no spots in listOnlyItems, not items", async () => {
    db.project.findMany.mockResolvedValue([project({ projectTerms: [{ termId: "t26s", pi: null }] })]);
    const data = await loadPlanningData("t26s");
    expect(data.items).toEqual([]);
    expect(data.listOnlyItems.map((i) => i.refId)).toEqual(["p1"]);
  });

  it("marks a renewal undecided and uses last term's spots when this term has none", async () => {
    db.project.findMany.mockResolvedValue([
      project({
        roleRequests: [{ termId: "t26w", domainId: "eng", slots: 4 }],
      }),
    ]);
    const data = await loadPlanningData("t26s");
    expect(data.items[0]).toMatchObject({ source: "renewing", state: "Undecided", spotsByDomain: { eng: 4 } });
  });

  it("marks a renewal continuing when the term status says so", async () => {
    db.project.findMany.mockResolvedValue([
      project({
        termStatuses: [{ isContinuing: true }],
        roleRequests: [{ termId: "t26s", domainId: "eng", slots: 1 }],
      }),
    ]);
    const data = await loadPlanningData("t26s");
    expect(data.items[0]).toMatchObject({ state: "Continuing", spotsByDomain: { eng: 1 } });
  });

  it("drops a renewal that is marked not continuing", async () => {
    db.project.findMany.mockResolvedValue([
      project({ termStatuses: [{ isContinuing: false }], roleRequests: [{ termId: "t26s", domainId: "eng", slots: 1 }] }),
    ]);
    const data = await loadPlanningData("t26s");
    expect([...data.items, ...data.listOnlyItems]).toEqual([]);
  });

  it("drops an archived project that has no spots", async () => {
    db.project.findMany.mockResolvedValue([project({ status: "Archived", projectTerms: [{ termId: "t26s", pi: null }] })]);
    const data = await loadPlanningData("t26s");
    expect([...data.items, ...data.listOnlyItems]).toEqual([]);
  });

  it("keeps the PI from the latest term at or before the planned term", async () => {
    const grace = { id: "u-grace", firstName: "Grace", lastName: "Hopper", daliEmail: "grace@example.edu" };
    db.project.findMany.mockResolvedValue([
      project({
        projectTerms: [
          { termId: "t25f", pi: ada },
          { termId: "t26w", pi: grace },
          { termId: "t26f", pi: null },
        ],
        termStatuses: [{ isContinuing: true }],
      }),
    ]);
    const data = await loadPlanningData("t26s");
    expect([...data.items, ...data.listOnlyItems][0].piName).toBe("Grace Hopper");
  });
});

describe("loadPlanningData applications", () => {
  it("turns a pipeline application into a new item with its stage and expected members", async () => {
    db.partnerApplication.findMany.mockResolvedValue([
      {
        id: "a1",
        title: "Example Org App",
        iconEmoji: null,
        stage: "Interview",
        pi: ada,
        domains: [
          { domainId: "eng", expectedMembers: 2 },
          { domainId: "eng", expectedMembers: 1 },
          { domainId: "des", expectedMembers: 0 },
        ],
      },
    ]);
    const data = await loadPlanningData("t26s");
    expect(data.items).toEqual([
      expect.objectContaining({
        key: "application:a1",
        kind: "application",
        source: "new",
        state: "Interview",
        spotsByDomain: { eng: 3 },
        piName: "Ada Lovelace",
      }),
    ]);
  });

  it("puts an application with no expected members in listOnlyItems and leaves piName null without a PI", async () => {
    db.partnerApplication.findMany.mockResolvedValue([
      { id: "a2", title: "Empty", iconEmoji: null, stage: "New", pi: null, domains: [] },
    ]);
    const data = await loadPlanningData("t26s");
    expect(data.items).toEqual([]);
    expect(data.listOnlyItems[0]).toMatchObject({ refId: "a2", piName: null });
  });
});

describe("loadPlanningData intent to work", () => {
  it("reports no replies and the no-form setup when the term has no staffing cycle", async () => {
    const data = await loadPlanningData("t26s");
    expect(db.intentToWork.findMany).not.toHaveBeenCalled();
    expect(data).toMatchObject({ replied: 0, returning: [], hasIntentData: false, roster: 40, intentSetup: { kind: "no-form" } });
  });

  it("counts distinct repliers and lists only Returning people with deduped eligibility domains", async () => {
    db.staffingCycle.findUnique.mockResolvedValue({ id: "c1", formBindings: [], _count: { formSubmissions: 0 } });
    db.intentToWork.findMany.mockResolvedValue([
      { userId: "u1", status: "Returning", user: { domainEligibilities: [{ domainId: "eng" }, { domainId: "eng" }, { domainId: "des" }] } },
      { userId: "u1", status: "Not returning", user: { domainEligibilities: [{ domainId: "eng" }] } },
      { userId: "u2", status: "Not returning", user: { domainEligibilities: [{ domainId: "eng" }] } },
    ]);
    const data = await loadPlanningData("t26s");
    expect(db.intentToWork.findMany.mock.calls[0][0].where).toEqual({ staffingCycleId: "c1", termId: "t26s" });
    expect(data.replied).toBe(2);
    expect(data.hasIntentData).toBe(true);
    expect(data.intentSetup).toEqual({ kind: "ready" });
    expect(data.returning).toEqual([{ userId: "u1", domainIds: ["eng", "des"] }]);
  });

  it("flags a bound form with submissions but no intent-status column as unmapped", async () => {
    db.staffingCycle.findUnique.mockResolvedValue({
      id: "c1",
      formBindings: [{ columnMapping: { entries: [] } }],
      _count: { formSubmissions: 5 },
    });
    const data = await loadPlanningData("t26s");
    expect(data.intentSetup).toEqual({ kind: "unmapped", submissions: 5 });
  });
});
