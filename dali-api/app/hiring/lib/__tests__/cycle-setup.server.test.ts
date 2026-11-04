import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn() }));
vi.mock("~/hiring/lib/core-hiring.server", () => ({
  getCoreDomain: vi.fn(),
  defaultCoreReviewerIds: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { currentTerm } from "~/lib/roles";
import { getCoreDomain, defaultCoreReviewerIds } from "~/hiring/lib/core-hiring.server";
import {
  loadMemberCycleSetup,
  handleMemberSetupIntent,
  startOfDayInAppTz,
  endOfDayInAppTz,
  loadTermOptions,
  loadPhaseStatusByDomain,
} from "~/hiring/lib/cycle-setup.server";

const db = prisma as any;

const form = (data: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
};

let tx: any;

beforeEach(() => {
  vi.clearAllMocks();
  tx = {
    cycleReviewer: { deleteMany: vi.fn(), createMany: vi.fn() },
    domainApplicationCycle: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  db.$transaction = vi.fn(async (fn: (t: any) => unknown) => fn(tx));
  db.domain = { findMany: vi.fn().mockResolvedValue([]) };
  db.cycleReviewer = { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn(), deleteMany: vi.fn() };
  db.dALIMember = { findMany: vi.fn().mockResolvedValue([]) };
  db.domainApplicationCycle = { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() };
  db.domainApplication = { findFirst: vi.fn().mockResolvedValue(null) };
  db.term = { findMany: vi.fn().mockResolvedValue([]) };
  db.applicationReview = { findMany: vi.fn().mockResolvedValue([]) };
  db.delibsSession = { findMany: vi.fn().mockResolvedValue([]) };
});

describe("loadMemberCycleSetup", () => {
  it("offers only active, non-intern, non-system domains", async () => {
    await loadMemberCycleSetup("c1");

    expect(db.domain.findMany.mock.calls[0][0].where).toEqual({ active: true, isInternProgram: false, isSystem: false });
  });

  it("shows each pool member once even though they hold one reviewer row per domain", async () => {
    db.cycleReviewer.findMany.mockResolvedValue([
      { userId: "u1", user: { firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" } },
      { userId: "u1", user: { firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" } },
      { userId: "u2", user: { firstName: null, lastName: null, daliEmail: "grace@example.edu" } },
    ]);
    db.dALIMember.findMany.mockResolvedValue([{ userId: "u3", user: { firstName: "Mary", lastName: null, daliEmail: null } }]);

    const res = await loadMemberCycleSetup("c1");

    expect(res.reviewerPool).toEqual([
      { userId: "u1", displayName: "Ada Lovelace" },
      { userId: "u2", displayName: "grace@example.edu" },
    ]);
    expect(res.members).toEqual([{ userId: "u3", displayName: "Mary" }]);
  });

  it("falls back to the user id when a person has no name or email", async () => {
    db.dALIMember.findMany.mockResolvedValue([{ userId: "u9", user: { firstName: null, lastName: null, daliEmail: null } }]);

    expect((await loadMemberCycleSetup("c1")).members).toEqual([{ userId: "u9", displayName: "u9" }]);
  });
});

describe("handleMemberSetupIntent", () => {
  it("returns null for intents it does not own so shared intents run", async () => {
    expect(await handleMemberSetupIntent("set-close-date", form({}), "c1", "Interns")).toBeNull();
  });

  describe("set-target-domains", () => {
    beforeEach(() => {
      db.domainApplicationCycle.findMany.mockResolvedValue([{ domainId: "d1" }, { domainId: "d2" }]);
      db.cycleReviewer.findMany.mockResolvedValue([{ userId: "u1" }, { userId: "u1" }, { userId: "u2" }]);
    });

    it("adds new domains and puts every pool member on them", async () => {
      const res = await handleMemberSetupIntent("set-target-domains", form({ domainIds: '["d1","d2","d3"]' }), "c1", "Interns");

      expect(res).toEqual({ ok: true });
      expect(tx.domainApplicationCycle.createMany).toHaveBeenCalledWith({
        data: [{ applicationCycleId: "c1", domainId: "d3" }],
      });
      expect(tx.cycleReviewer.createMany).toHaveBeenCalledWith({
        data: [
          { userId: "u1", applicationCycleId: "c1", domainId: "d3" },
          { userId: "u2", applicationCycleId: "c1", domainId: "d3" },
        ],
        skipDuplicates: true,
      });
      expect(tx.cycleReviewer.deleteMany).not.toHaveBeenCalled();
    });

    it("removes dropped domains together with their reviewers", async () => {
      await handleMemberSetupIntent("set-target-domains", form({ domainIds: '["d1"]' }), "c1", "Interns");

      expect(tx.cycleReviewer.deleteMany).toHaveBeenCalledWith({
        where: { applicationCycleId: "c1", domainId: { in: ["d2"] } },
      });
      expect(tx.domainApplicationCycle.deleteMany).toHaveBeenCalledWith({
        where: { applicationCycleId: "c1", domainId: { in: ["d2"] } },
      });
      expect(tx.domainApplicationCycle.createMany).not.toHaveBeenCalled();
    });

    it("refuses with 409 to remove a domain applicants already picked", async () => {
      db.domainApplication.findFirst.mockResolvedValue({ id: "da1" });

      const res = (await handleMemberSetupIntent("set-target-domains", form({ domainIds: '["d1"]' }), "c1", "Interns")) as Response;

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Can't remove a domain applicants already picked." });
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(db.domainApplication.findFirst.mock.calls[0][0].where).toEqual({
        domainId: { in: ["d2"] },
        application: { applicationCycleId: "c1" },
      });
    });

    it("adds domains without reviewer rows when the pool is empty", async () => {
      db.cycleReviewer.findMany.mockResolvedValue([]);

      await handleMemberSetupIntent("set-target-domains", form({ domainIds: '["d1","d2","d3"]' }), "c1", "Interns");

      expect(tx.domainApplicationCycle.createMany).toHaveBeenCalled();
      expect(tx.cycleReviewer.createMany).not.toHaveBeenCalled();
    });
  });

  describe("add-reviewer-pool", () => {
    it("adds the member to every target domain", async () => {
      db.domainApplicationCycle.findMany.mockResolvedValue([{ domainId: "d1" }, { domainId: "d2" }]);

      expect(await handleMemberSetupIntent("add-reviewer-pool", form({ userId: "u1" }), "c1", "Interns")).toEqual({ ok: true });

      expect(db.cycleReviewer.createMany).toHaveBeenCalledWith({
        data: [
          { userId: "u1", applicationCycleId: "c1", domainId: "d1" },
          { userId: "u1", applicationCycleId: "c1", domainId: "d2" },
        ],
        skipDuplicates: true,
      });
    });

    it("refuses with 409 until a domain is picked", async () => {
      const res = (await handleMemberSetupIntent("add-reviewer-pool", form({ userId: "u1" }), "c1", "Interns")) as Response;

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Pick at least one domain first." });
      expect(db.cycleReviewer.createMany).not.toHaveBeenCalled();
    });
  });

  it("remove-reviewer-pool drops the member from every domain of the cycle", async () => {
    expect(await handleMemberSetupIntent("remove-reviewer-pool", form({ userId: "u1" }), "c1", "Interns")).toEqual({ ok: true });

    expect(db.cycleReviewer.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", applicationCycleId: "c1" } });
  });

  describe("reset-default-reviewers", () => {
    it("is only for Lab members cycles", async () => {
      const res = (await handleMemberSetupIntent("reset-default-reviewers", form({}), "c1", "Interns")) as Response;

      expect(res.status).toBe(400);
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("needs the Core domain to exist", async () => {
      vi.mocked(getCoreDomain).mockResolvedValue(null as any);

      const res = (await handleMemberSetupIntent("reset-default-reviewers", form({}), "c1", "LabMembers")) as Response;

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Core domain is not configured." });
    });

    it("replaces the pool with the default Core reviewers on the Core domain", async () => {
      vi.mocked(getCoreDomain).mockResolvedValue({ id: "core" } as any);
      vi.mocked(defaultCoreReviewerIds).mockResolvedValue(["u1", "u2"]);

      const res = await handleMemberSetupIntent("reset-default-reviewers", form({}), "c1", "LabMembers");

      expect(res).toEqual({ ok: true, resetCount: 2 });
      expect(tx.cycleReviewer.deleteMany).toHaveBeenCalledWith({ where: { applicationCycleId: "c1" } });
      expect(tx.cycleReviewer.createMany).toHaveBeenCalledWith({
        data: [
          { userId: "u1", applicationCycleId: "c1", domainId: "core" },
          { userId: "u2", applicationCycleId: "c1", domainId: "core" },
        ],
        skipDuplicates: true,
      });
    });

    it("clears the pool and creates nothing when there are no default reviewers", async () => {
      vi.mocked(getCoreDomain).mockResolvedValue({ id: "core" } as any);
      vi.mocked(defaultCoreReviewerIds).mockResolvedValue([]);

      expect(await handleMemberSetupIntent("reset-default-reviewers", form({}), "c1", "LabMembers")).toEqual({ ok: true, resetCount: 0 });
      expect(tx.cycleReviewer.deleteMany).toHaveBeenCalled();
      expect(tx.cycleReviewer.createMany).not.toHaveBeenCalled();
    });
  });
});

describe("day anchors in the application timezone", () => {
  it("starts a UTC-midnight calendar day at midnight Eastern", () => {
    expect(startOfDayInAppTz(new Date("2026-11-10T00:00:00Z")).toISOString()).toBe("2026-11-10T05:00:00.000Z");
  });

  it("ends the same calendar day at 23:59:59 Eastern", () => {
    expect(endOfDayInAppTz(new Date("2026-11-10T00:00:00Z")).toISOString()).toBe("2026-11-11T04:59:59.000Z");
  });

  it("follows daylight saving time", () => {
    expect(startOfDayInAppTz(new Date("2026-07-10T00:00:00Z")).toISOString()).toBe("2026-07-10T04:00:00.000Z");
  });
});

describe("loadTermOptions", () => {
  it("flags only the current term", async () => {
    db.term.findMany.mockResolvedValue([
      { id: "t2", code: "27W" },
      { id: "t1", code: "26F" },
    ]);
    vi.mocked(currentTerm).mockResolvedValue({ id: "t1" } as any);

    expect(await loadTermOptions(new Request("http://localhost/"))).toEqual([
      { id: "t2", code: "27W", isCurrent: false },
      { id: "t1", code: "26F", isCurrent: true },
    ]);
    expect(db.term.findMany.mock.calls[0][0].orderBy).toEqual({ sortKey: "desc" });
  });

  it("flags nothing when there is no current term", async () => {
    db.term.findMany.mockResolvedValue([{ id: "t1", code: "26F" }]);
    vi.mocked(currentTerm).mockResolvedValue(null as any);

    expect((await loadTermOptions(new Request("http://localhost/")))[0].isCurrent).toBe(false);
  });
});

describe("loadPhaseStatusByDomain", () => {
  it("counts assigned and submitted reviews per domain and maps delib status to active or closed", async () => {
    db.applicationReview.findMany.mockResolvedValue([
      { submittedAt: new Date(), domainApplication: { domainId: "d1" } },
      { submittedAt: null, domainApplication: { domainId: "d1" } },
      { submittedAt: null, domainApplication: { domainId: "d2" } },
    ]);
    db.delibsSession.findMany.mockResolvedValue([
      { domainId: "d1", roundId: "r1", status: "Closed" },
      { domainId: "d1", roundId: "r2", status: "Open" },
      { domainId: "d3", roundId: "r1", status: "Open" },
    ]);

    expect(await loadPhaseStatusByDomain("c1")).toEqual({
      d1: { reviews: { assigned: 2, submitted: 1 }, rounds: { r1: "closed", r2: "active" } },
      d2: { reviews: { assigned: 1, submitted: 0 }, rounds: {} },
      d3: { reviews: { assigned: 0, submitted: 0 }, rounds: { r1: "active" } },
    });
  });

  it("only counts reviews of applications in the review pipeline", async () => {
    await loadPhaseStatusByDomain("c1");

    expect(db.applicationReview.findMany.mock.calls[0][0].where).toEqual({
      domainApplication: {
        application: {
          applicationCycleId: "c1",
          statusUpdates: { some: { newStatus: "Submitted" } },
          NOT: { statusUpdates: { some: { newStatus: "Withdrawn" } } },
        },
      },
    });
  });
});
