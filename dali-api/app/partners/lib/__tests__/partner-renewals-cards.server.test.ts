import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    project: { findMany: vi.fn() },
    projectTermStatus: { findMany: vi.fn() },
    projectRoleRequest: { findMany: vi.fn() },
    partnerActivity: { groupBy: vi.fn() },
  },
}));

import { prisma } from "~/lib/db.server";
import { loadRenewalCards } from "../partner-renewals.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const T1 = { id: "t1", code: "26W", sortKey: 2 };
const T2 = { id: "t2", code: "26S", sortKey: 3 };
const T3 = { id: "t3", code: "26F", sortKey: 4 };
const ALL = [T1, T2, T3];
const ada = { id: "u1", firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" };

function project(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "Example Project",
    iconEmoji: null,
    projectTerms: [{ termId: "t1", pi: ada }],
    partners: [{ endedAt: null, partnerOrg: { id: "o1", name: "Example Org" } }],
    ...over,
  };
}

function status(over: Record<string, unknown>) {
  return { projectId: "p1", termId: "t2", isContinuing: null, feeCents: null, reason: null, nextStep: null, nextStepDueAt: null, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.project.findMany.mockResolvedValue([project()]);
  db.projectTermStatus.findMany.mockResolvedValue([]);
  db.projectRoleRequest.findMany.mockResolvedValue([]);
  db.partnerActivity.groupBy.mockResolvedValue([]);
});

describe("loadRenewalCards", () => {
  it("decides for the term after the picked one", async () => {
    const { decisionTerm } = await loadRenewalCards(T1, ALL);
    expect(decisionTerm).toEqual(T2);
    expect(db.projectTermStatus.findMany.mock.calls[0][0].where).toEqual({
      projectId: { in: ["p1"] },
      termId: { in: ["t1", "t2", "t3"] },
    });
  });

  it("returns no cards when the picked term is the last one", async () => {
    const out = await loadRenewalCards(T3, ALL);
    expect(out).toEqual({ decisionTerm: null, cards: [] });
  });

  it("returns no cards, and skips the status queries, when no project runs in the picked term", async () => {
    db.project.findMany.mockResolvedValue([]);
    const out = await loadRenewalCards(T1, ALL);
    expect(out.cards).toEqual([]);
    expect(db.projectTermStatus.findMany).not.toHaveBeenCalled();
  });

  it("puts a project with no decision row in the undecided column", async () => {
    const { cards } = await loadRenewalCards(T1, ALL);
    expect(cards[0]).toMatchObject({ column: "undecided", piName: "Ada Lovelace", piUserId: "u1", orgName: "Example Org", feeCents: null });
  });

  it("shows a continuing project with its fee and next step from the continuing term", async () => {
    db.projectTermStatus.findMany.mockResolvedValue([
      status({ isContinuing: true, feeCents: 9000, nextStep: "Send SOW", nextStepDueAt: new Date("2026-05-01T00:00:00Z") }),
    ]);
    const { cards } = await loadRenewalCards(T1, ALL);
    expect(cards[0]).toMatchObject({
      column: "continuing",
      fromTermCode: null,
      feeCents: 9000,
      nextStep: "Send SOW",
      nextStepDueAt: "2026-05-01T00:00:00.000Z",
      reason: null,
    });
  });

  it("when the project skips a term, reports which later term it continues from and reads fee from that row", async () => {
    db.projectTermStatus.findMany.mockResolvedValue([
      status({ termId: "t2", isContinuing: false, reason: "Skipping" }),
      status({ termId: "t3", isContinuing: true, feeCents: 5000 }),
    ]);
    const { cards } = await loadRenewalCards(T1, ALL);
    expect(cards[0]).toMatchObject({ column: "continuing", fromTermCode: "26F", feeCents: 5000, reason: null });
  });

  it("shows the reason only for a not-continuing project, taken from the decision term row", async () => {
    db.projectTermStatus.findMany.mockResolvedValue([status({ isContinuing: false, reason: "Out of budget", feeCents: 1 })]);
    const { cards } = await loadRenewalCards(T1, ALL);
    expect(cards[0]).toMatchObject({ column: "not_continuing", reason: "Out of budget" });
  });

  it("ignores status rows from terms before the decision term", async () => {
    db.projectTermStatus.findMany.mockResolvedValue([status({ termId: "t1", isContinuing: true })]);
    const { cards } = await loadRenewalCards(T1, ALL);
    expect(cards[0].column).toBe("undecided");
  });

  it("merges role requests by domain, last roles from the picked term and decided roles from the effective term", async () => {
    db.projectTermStatus.findMany.mockResolvedValue([status({ isContinuing: true })]);
    db.projectRoleRequest.findMany.mockResolvedValue([
      { projectId: "p1", termId: "t1", slots: 2, domain: { id: "d1", displayName: "Engineering" } },
      { projectId: "p1", termId: "t1", slots: 1, domain: { id: "d1", displayName: "Engineering" } },
      { projectId: "p1", termId: "t2", slots: 4, domain: { id: "d2", displayName: "Design" } },
      { projectId: "other", termId: "t1", slots: 9, domain: { id: "d1", displayName: "Engineering" } },
    ]);
    const { cards } = await loadRenewalCards(T1, ALL);
    expect(cards[0].lastRoles).toEqual([{ domainId: "d1", name: "Engineering", slots: 3 }]);
    expect(cards[0].decidedRoles).toEqual([{ domainId: "d2", name: "Design", slots: 4 }]);
  });

  it("uses the active partner org and its latest activity as last contact, falling back to ended links", async () => {
    db.project.findMany.mockResolvedValue([
      project({
        partners: [
          { endedAt: new Date("2025-01-01T00:00:00Z"), partnerOrg: { id: "old", name: "Old Org" } },
          { endedAt: null, partnerOrg: { id: "o1", name: "Example Org" } },
        ],
      }),
      project({
        id: "p2",
        partners: [{ endedAt: new Date("2025-01-01T00:00:00Z"), partnerOrg: { id: "old", name: "Old Org" } }],
      }),
    ]);
    db.partnerActivity.groupBy.mockResolvedValue([
      { orgId: "o1", _max: { createdAt: new Date("2026-02-01T00:00:00Z") } },
      { orgId: "old", _max: { createdAt: new Date("2025-06-01T00:00:00Z") } },
    ]);
    const { cards } = await loadRenewalCards(T1, ALL);
    expect(cards[0]).toMatchObject({ orgName: "Example Org", lastContactAt: "2026-02-01T00:00:00.000Z" });
    expect(cards[1]).toMatchObject({ orgName: "Old Org", lastContactAt: "2025-06-01T00:00:00.000Z" });
  });

  it("skips the activity query when no org is linked and leaves org and contact empty", async () => {
    db.project.findMany.mockResolvedValue([project({ partners: [] })]);
    const { cards } = await loadRenewalCards(T1, ALL);
    expect(db.partnerActivity.groupBy).not.toHaveBeenCalled();
    expect(cards[0]).toMatchObject({ orgName: null, lastContactAt: null });
  });

  it("keeps a PI set in an earlier term until a later term replaces it", async () => {
    const grace = { id: "u2", firstName: "Grace", lastName: "Hopper", daliEmail: "grace@example.edu" };
    db.project.findMany.mockResolvedValue([
      project({
        projectTerms: [
          { termId: "t1", pi: ada },
          { termId: "t2", pi: grace },
        ],
      }),
    ]);
    const picked = await loadRenewalCards(T1, ALL);
    expect(picked.cards[0].piUserId).toBe("u1");
    const later = await loadRenewalCards(T2, ALL);
    expect(later.cards[0].piUserId).toBe("u2");
  });
});
