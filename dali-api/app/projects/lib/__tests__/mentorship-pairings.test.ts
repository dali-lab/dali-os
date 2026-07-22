import { describe, it, expect, vi } from "vitest";
import { derivePairings, findDomainsMissingMentors } from "../mentorship-pairings";

type Row = { userId: string; domainId: string; level: "P1" | "P2" | "P3" };
type Pair = { menteeUserId: string; mentorUserId: string; domainId: string };

function mkTx(assignments: Row[], existing: (Pair & { id?: string })[]) {
  const created: Pair[] = [];
  const deleted: string[] = [];
  const withIds = existing.map((p, i) => ({ id: p.id ?? `existing-${i}`, ...p }));
  const tx = {
    projectAssignment: {
      findMany: vi.fn().mockResolvedValue(assignments),
    },
    mentorshipPair: {
      findMany: vi.fn().mockResolvedValue(withIds),
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
      deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
        const ids: string[] = where.id.in;
        deleted.push(...ids);
        return { count: ids.length };
      }),
    },
  };
  return { tx, created, deleted };
}

describe("derivePairings", () => {
  it("creates one pair per (mentee, mentor) in the same domain", async () => {
    const { tx, created } = mkTx(
      [
        { userId: "mentee-a", domainId: "d1", level: "P1" },
        { userId: "mentee-b", domainId: "d1", level: "P2" },
        { userId: "mentor-x", domainId: "d1", level: "P3" },
      ],
      [],
    );
    const n = await derivePairings(tx as any, "proj1", "term1");
    expect(n).toBe(2);
    expect(created).toEqual([
      { menteeUserId: "mentee-a", mentorUserId: "mentor-x", domainId: "d1" },
      { menteeUserId: "mentee-b", mentorUserId: "mentor-x", domainId: "d1" },
    ]);
  });

  it("does not cross domain boundaries", async () => {
    const { tx, created } = mkTx(
      [
        { userId: "mentee-a", domainId: "d1", level: "P1" },
        { userId: "mentor-x", domainId: "d2", level: "P3" },
      ],
      [],
    );
    const n = await derivePairings(tx as any, "proj1", "term1");
    expect(n).toBe(0);
    expect(created).toEqual([]);
  });

  it("pairs to multiple mentors in the same domain", async () => {
    const { tx, created } = mkTx(
      [
        { userId: "mentee-a", domainId: "d1", level: "P1" },
        { userId: "mentor-x", domainId: "d1", level: "P3" },
        { userId: "mentor-y", domainId: "d1", level: "P3" },
      ],
      [],
    );
    const n = await derivePairings(tx as any, "proj1", "term1");
    expect(n).toBe(2);
  });

  it("is additive: skips pairs that already exist (Core override preserved)", async () => {
    const { tx, created } = mkTx(
      [
        { userId: "mentee-a", domainId: "d1", level: "P1" },
        { userId: "mentor-x", domainId: "d1", level: "P3" },
        { userId: "mentor-y", domainId: "d1", level: "P3" },
      ],
      [
        { menteeUserId: "mentee-a", mentorUserId: "mentor-x", domainId: "d1" },
      ],
    );
    const n = await derivePairings(tx as any, "proj1", "term1");
    expect(n).toBe(1);
    expect(created).toEqual([
      { menteeUserId: "mentee-a", mentorUserId: "mentor-y", domainId: "d1" },
    ]);
  });

  it("prunes pairs whose mentee is no longer staffed in that domain", async () => {
    // Gaelle moved Fullstack → UI/UX: old Fullstack→Moiz pair must go; new
    // UI/UX mentor pair is created.
    const { tx, created, deleted } = mkTx(
      [
        { userId: "gaelle", domainId: "uiux", level: "P1" },
        { userId: "uiux-mentor", domainId: "uiux", level: "P3" },
        { userId: "moiz", domainId: "fullstack", level: "P3" },
      ],
      [
        {
          id: "stale-fs",
          menteeUserId: "gaelle",
          mentorUserId: "moiz",
          domainId: "fullstack",
        },
      ],
    );
    const n = await derivePairings(tx as any, "proj1", "term1");
    expect(deleted).toEqual(["stale-fs"]);
    expect(n).toBe(1);
    expect(created).toEqual([
      { menteeUserId: "gaelle", mentorUserId: "uiux-mentor", domainId: "uiux" },
    ]);
  });

  it("never creates pairs when there is no P3 in the domain", async () => {
    const { tx, created } = mkTx(
      [
        { userId: "mentee-a", domainId: "d1", level: "P1" },
        { userId: "mentee-b", domainId: "d1", level: "P2" },
      ],
      [],
    );
    const n = await derivePairings(tx as any, "proj1", "term1");
    expect(n).toBe(0);
    expect(created).toEqual([]);
  });

  it("role override promotes a non-P3 to mentor", async () => {
    const { tx, created } = mkTx(
      [
        { userId: "mentee-a", domainId: "d1", level: "P1" },
        { userId: "mentor-p2", domainId: "d1", level: "P2" },
      ],
      [],
    );
    const n = await derivePairings(tx as any, "proj1", "term1", {
      roleOverride: new Map([["mentor-p2", true]]),
    });
    expect(n).toBe(1);
    expect(created).toEqual([
      { menteeUserId: "mentee-a", mentorUserId: "mentor-p2", domainId: "d1" },
    ]);
  });

  it("role override demotes a P3 to mentee", async () => {
    const { tx, created } = mkTx(
      [
        { userId: "p3-demoted", domainId: "d1", level: "P3" },
        { userId: "mentor-x", domainId: "d1", level: "P3" },
      ],
      [],
    );
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
