import { describe, it, expect, vi } from "vitest";
import { derivePairings } from "../mentorship-pairings";

type Row = { userId: string; domainId: string; level: "P1" | "P2" | "P3" };
type Pair = { menteeUserId: string; mentorUserId: string; domainId: string };

function mkTx(assignments: Row[], existing: Pair[]) {
  const created: Pair[] = [];
  const tx = {
    projectAssignment: {
      findMany: vi.fn().mockResolvedValue(assignments),
    },
    mentorshipPair: {
      findMany: vi.fn().mockResolvedValue(existing),
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
  return { tx, created };
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
});
