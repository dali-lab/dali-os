import { describe, it, expect, vi } from "vitest";
import { derivePairings, findDomainsMissingMentors } from "../mentorship-pairings";

type Row = { userId: string; domainId: string; level: "P1" | "P2" | "P3" };
type Pair = { menteeUserId: string; mentorUserId: string; domainId: string };

function mkTx(assignments: Row[]) {
  const created: Pair[] = [];
  let deletedWhere: { projectId: string; termId: string } | null = null;
  const tx = {
    projectAssignment: {
      findMany: vi.fn().mockResolvedValue(assignments),
    },
    mentorshipPair: {
      deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
        deletedWhere = where;
        return { count: 1 };
      }),
      createMany: vi.fn().mockImplementation(async ({ data }: any) => {
        for (const d of data) {
          created.push({
            menteeUserId: d.menteeUserId,
            mentorUserId: d.mentorUserId,
            domainId: d.domainId,
          });
        }
        return { count: data.length };
      }),
    },
  };
  return {
    tx,
    created,
    getDeletedWhere: () => deletedWhere,
  };
}

describe("derivePairings", () => {
  it("creates one pair per (mentee, mentor) in the same domain", async () => {
    const { tx, created, getDeletedWhere } = mkTx([
      { userId: "mentee-a", domainId: "d1", level: "P1" },
      { userId: "mentee-b", domainId: "d1", level: "P2" },
      { userId: "mentor-x", domainId: "d1", level: "P3" },
    ]);
    const n = await derivePairings(tx as any, "proj1", "term1");
    expect(getDeletedWhere()).toEqual({ projectId: "proj1", termId: "term1" });
    expect(n).toBe(2);
    expect(created).toEqual([
      { menteeUserId: "mentee-a", mentorUserId: "mentor-x", domainId: "d1" },
      { menteeUserId: "mentee-b", mentorUserId: "mentor-x", domainId: "d1" },
    ]);
  });

  it("does not cross domain boundaries", async () => {
    const { tx, created } = mkTx([
      { userId: "mentee-a", domainId: "d1", level: "P1" },
      { userId: "mentor-x", domainId: "d2", level: "P3" },
    ]);
    const n = await derivePairings(tx as any, "proj1", "term1");
    expect(n).toBe(0);
    expect(created).toEqual([]);
  });

  it("pairs to multiple mentors in the same domain", async () => {
    const { tx, created } = mkTx([
      { userId: "mentee-a", domainId: "d1", level: "P1" },
      { userId: "mentor-x", domainId: "d1", level: "P3" },
      { userId: "mentor-y", domainId: "d1", level: "P3" },
    ]);
    const n = await derivePairings(tx as any, "proj1", "term1");
    expect(n).toBe(2);
  });

  it("replaces prior pairs for the project+term (domain moves drop old links)", async () => {
    // Even with no new pairs to create, prior rows for this project+term are cleared.
    const { tx, created, getDeletedWhere } = mkTx([
      { userId: "gaelle", domainId: "uiux", level: "P1" },
      { userId: "moiz", domainId: "fullstack", level: "P3" },
    ]);
    const n = await derivePairings(tx as any, "evergreen", "26x");
    expect(getDeletedWhere()).toEqual({ projectId: "evergreen", termId: "26x" });
    expect(n).toBe(0);
    expect(created).toEqual([]);
  });

  it("rebuilds the full derived set after clearing prior pairs", async () => {
    const { tx, created } = mkTx([
      { userId: "mentee-a", domainId: "d1", level: "P1" },
      { userId: "mentor-x", domainId: "d1", level: "P3" },
      { userId: "mentor-y", domainId: "d1", level: "P3" },
    ]);
    const n = await derivePairings(tx as any, "proj1", "term1");
    expect(n).toBe(2);
    expect(created).toEqual([
      { menteeUserId: "mentee-a", mentorUserId: "mentor-x", domainId: "d1" },
      { menteeUserId: "mentee-a", mentorUserId: "mentor-y", domainId: "d1" },
    ]);
  });

  it("never creates pairs when there is no P3 in the domain", async () => {
    const { tx, created, getDeletedWhere } = mkTx([
      { userId: "mentee-a", domainId: "d1", level: "P1" },
      { userId: "mentee-b", domainId: "d1", level: "P2" },
    ]);
    const n = await derivePairings(tx as any, "proj1", "term1");
    expect(getDeletedWhere()).toEqual({ projectId: "proj1", termId: "term1" });
    expect(n).toBe(0);
    expect(created).toEqual([]);
  });

  it("role override promotes a non-P3 to mentor", async () => {
    const { tx, created } = mkTx([
      { userId: "mentee-a", domainId: "d1", level: "P1" },
      { userId: "mentor-p2", domainId: "d1", level: "P2" },
    ]);
    const n = await derivePairings(tx as any, "proj1", "term1", {
      roleOverride: new Map([["mentor-p2", true]]),
    });
    expect(n).toBe(1);
    expect(created).toEqual([
      { menteeUserId: "mentee-a", mentorUserId: "mentor-p2", domainId: "d1" },
    ]);
  });

  it("role override demotes a P3 to mentee", async () => {
    const { tx, created } = mkTx([
      { userId: "p3-demoted", domainId: "d1", level: "P3" },
      { userId: "mentor-x", domainId: "d1", level: "P3" },
    ]);
    const n = await derivePairings(tx as any, "proj1", "term1", {
      roleOverride: new Map([["p3-demoted", false]]),
    });
    expect(n).toBe(1);
    expect(created).toEqual([
      { menteeUserId: "p3-demoted", mentorUserId: "mentor-x", domainId: "d1" },
    ]);
  });
});

describe("findDomainsMissingMentors", () => {
  it("flags a domain with multiple mentees and no mentor", () => {
    const gaps = findDomainsMissingMentors([
      { userId: "oscar", domainId: "uiux", level: "P2" },
      { userId: "emma", domainId: "uiux", level: "P1" },
    ]);
    expect(gaps).toEqual([
      { domainId: "uiux", menteeUserIds: ["oscar", "emma"] },
    ]);
  });

  it("ignores solo mentee domains", () => {
    const gaps = findDomainsMissingMentors([
      { userId: "claire", domainId: "arvr", level: "P2" },
    ]);
    expect(gaps).toEqual([]);
  });

  it("ignores domains that have a P3 mentor", () => {
    const gaps = findDomainsMissingMentors([
      { userId: "oscar", domainId: "uiux", level: "P3" },
      { userId: "emma", domainId: "uiux", level: "P1" },
    ]);
    expect(gaps).toEqual([]);
  });

  it("honours mentor role override and external mentors", () => {
    expect(
      findDomainsMissingMentors(
        [
          { userId: "oscar", domainId: "uiux", level: "P2" },
          { userId: "emma", domainId: "uiux", level: "P1" },
        ],
        { roleOverride: new Map([["oscar", true]]) },
      ),
    ).toEqual([]);

    expect(
      findDomainsMissingMentors(
        [
          { userId: "emma", domainId: "uiux", level: "P1" },
          { userId: "other", domainId: "uiux", level: "P1" },
        ],
        { externalMentors: [{ userId: "ext", domainId: "uiux" }] },
      ),
    ).toEqual([]);
  });
});
