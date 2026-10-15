import { describe, it, expect } from "vitest";
import { PAIR_REASON, suggestFiling, suggestPairFiling } from "~/calendar/lib/suggest-filing";
import type { GroupOption } from "~/calendar/lib/types";

const group = (over: Partial<GroupOption> & { id: string; name: string }): GroupOption => ({
  memberIds: [],
  projectId: null,
  systemKey: null,
  ...over,
});

const people = (n: number, prefix = "u") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

const atlas = group({ id: "g-atlas", name: "Atlas", projectId: "p-atlas", memberIds: ["a", "b", "c", "d"] });
const core = group({ id: "g-core", name: "Core", systemKey: "core", memberIds: ["a", "b", "x", "y"] });
const offering = group({ id: "g-off", name: "Intro to Design", systemKey: "offering:o1", memberIds: ["a", "b"] });
const plain = group({ id: "g-plain", name: "Everyone", memberIds: ["a", "b", "c", "d"] });

describe("suggestFiling", () => {
  it("suggests nothing with no groups", () => {
    expect(suggestFiling({ attendeeIds: ["a", "b"], groups: [], title: "Sync" })).toEqual([]);
  });

  it("suggests nothing for empty attendees and a title that names nothing", () => {
    expect(suggestFiling({ attendeeIds: [], groups: [atlas, core], title: "Weekly" })).toEqual([]);
  });

  it("ignores groups that are neither project nor Core, offerings included", () => {
    expect(suggestFiling({ attendeeIds: ["a", "b", "c", "d"], groups: [plain, offering], title: "Everyone" })).toEqual([]);
  });

  it("scores coverage: the share of the group in the room", () => {
    const [s] = suggestFiling({ attendeeIds: ["a", "b", "c", "z"], groups: [atlas], title: "Sync" });
    expect(s).toMatchObject({ groupId: "g-atlas", kind: "project", score: 0.75, overlap: 3, attendees: 4 });
  });

  it("ranks a four-person project that is all in the room above Core at four of forty", () => {
    const bigCore = group({ id: "g-core", name: "Core", systemKey: "core", memberIds: ["a", "b", "c", "d", ...people(36)] });
    const out = suggestFiling({ attendeeIds: ["a", "b", "c", "d"], groups: [bigCore, atlas], title: "Sync" });
    expect(out.map((s) => [s.groupId, s.score])).toEqual([
      ["g-atlas", 1],
      ["g-core", 0.1],
    ]);
  });

  it("counts each attendee and each member once", () => {
    const dup = group({ id: "g", name: "Dupes", projectId: "p", memberIds: ["a", "a", "b", "b"] });
    const [s] = suggestFiling({ attendeeIds: ["a", "a", "b", "z"], groups: [dup], title: "Sync" });
    expect(s).toMatchObject({ score: 1, overlap: 2, attendees: 3 });
  });

  it("scores an empty group at zero", () => {
    const empty = group({ id: "g", name: "Empty", projectId: "p" });
    expect(suggestFiling({ attendeeIds: ["a"], groups: [empty], title: "Empty review" })[0]).toMatchObject({ score: 0.5 });
  });

  describe("threshold", () => {
    it("needs one invited member", () => {
      expect(suggestFiling({ attendeeIds: ["z"], groups: [atlas], title: "Sync" })).toEqual([]);
      expect(suggestFiling({ attendeeIds: ["a", "z"], groups: [atlas], title: "Sync" })).toHaveLength(1);
      expect(suggestFiling({ attendeeIds: ["a", "b"], groups: [atlas], title: "Sync" })).toHaveLength(1);
    });

    it("keeps a low-coverage group with one member in the room", () => {
      const out = suggestFiling({ attendeeIds: ["a", "z"], groups: [core], title: "Sync" });
      expect(out[0]).toMatchObject({ score: 0.25, overlap: 1, reason: "1 of 2 attendees" });
    });

    it("lets a name in the title stand in for the overlap", () => {
      const out = suggestFiling({ attendeeIds: ["a", "z"], groups: [atlas], title: "Atlas planning" });
      expect(out[0]).toMatchObject({ score: 0.25 + 0.5, reason: "1 of 2 attendees" });
    });
  });

  describe("title match", () => {
    it("adds 0.5 for a project name in the title, case-insensitively", () => {
      const out = suggestFiling({ attendeeIds: ["a", "b", "c", "d"], groups: [atlas], title: "ATLAS standup" });
      expect(out[0]).toMatchObject({ score: 1.5, reason: "4 of 4 attendees" });
    });

    it("keeps a title match with no roster overlap", () => {
      const out = suggestFiling({ attendeeIds: ["z"], groups: [atlas], title: "Atlas planning" });
      expect(out[0]).toMatchObject({ groupId: "g-atlas", score: 0.5, reason: "named in the title" });
    });

    it("ignores names shorter than four characters", () => {
      const short = group({ id: "g", name: "Eve", projectId: "p", memberIds: ["a"] });
      expect(suggestFiling({ attendeeIds: ["z"], groups: [short], title: "Eve and friends" })).toEqual([]);
    });

    it("matches a name of exactly four characters", () => {
      const four = group({ id: "g", name: "Sage", projectId: "p" });
      expect(suggestFiling({ attendeeIds: ["z"], groups: [four], title: "sage sync" })).toHaveLength(1);
    });

    it("trims the group name before measuring it", () => {
      const padded = group({ id: "g", name: "  Sa  ", projectId: "p" });
      expect(suggestFiling({ attendeeIds: ["z"], groups: [padded], title: "sa sync" })).toEqual([]);
    });
  });

  describe("Core", () => {
    it("is a candidate on roster overlap alone", () => {
      const out = suggestFiling({ attendeeIds: ["a", "b", "x", "q"], groups: [core], title: "Sync" });
      expect(out).toEqual([
        { groupId: "g-core", label: "Core", kind: "core", score: 0.75, overlap: 3, attendees: 4, reason: "3 of 4 attendees" },
      ]);
    });

    it("adds 0.3 when the title has the word core", () => {
      const out = suggestFiling({ attendeeIds: ["z"], groups: [core], title: "Core sync" });
      expect(out[0]).toMatchObject({ kind: "core", score: 0.3, reason: "named in the title" });
    });

    it("does not treat core inside another word as a match", () => {
      expect(suggestFiling({ attendeeIds: ["z"], groups: [core], title: "Hardcore scorecards" })).toEqual([]);
    });

    it("is recognised by system key, not by name", () => {
      const renamed = group({ id: "g", name: "Leadership", systemKey: "core", memberIds: ["a", "b"] });
      expect(suggestFiling({ attendeeIds: ["a", "b"], groups: [renamed], title: "Sync" })[0]!.kind).toBe("core");
    });
  });

  describe("reason", () => {
    it("reads overlap of attendees", () => {
      expect(suggestFiling({ attendeeIds: ["a", "b", "c", "d", "e", "f"], groups: [atlas], title: "Sync" })[0]!.reason).toBe(
        "4 of 6 attendees",
      );
    });

    it("uses the singular for a lone attendee", () => {
      expect(suggestFiling({ attendeeIds: ["a"], groups: [atlas], title: "Atlas" })[0]!.reason).toBe("1 of 1 attendee");
    });
  });

  describe("ordering", () => {
    it("returns the best three", () => {
      const many = Array.from({ length: 5 }, (_, i) =>
        group({ id: `g${i}`, name: `Project ${i}`, projectId: `p${i}`, memberIds: ["a", "b", ...people(i)] }),
      );
      const out = suggestFiling({ attendeeIds: ["a", "b"], groups: many, title: "Sync" });
      expect(out.map((s) => s.groupId)).toEqual(["g0", "g1", "g2"]);
    });

    it("breaks score ties by larger overlap, then name, then id", () => {
      const x = group({ id: "g-x", name: "Beta", projectId: "p3", memberIds: ["a", "b"] });
      const y = group({ id: "g-y", name: "Alpha", projectId: "p4", memberIds: ["a", "b"] });
      expect(suggestFiling({ attendeeIds: ["a", "b"], groups: [x, y], title: "Sync" }).map((s) => s.label)).toEqual([
        "Alpha",
        "Beta",
      ]);
      const twin1 = group({ id: "g-2", name: "Same", projectId: "p5", memberIds: ["a", "b"] });
      const twin2 = group({ id: "g-1", name: "Same", projectId: "p6", memberIds: ["a", "b"] });
      expect(suggestFiling({ attendeeIds: ["a", "b"], groups: [twin1, twin2], title: "Sync" }).map((s) => s.groupId)).toEqual([
        "g-1",
        "g-2",
      ]);
    });

    it("prefers the larger overlap on equal scores", () => {
      const small = group({ id: "g-small", name: "Small", projectId: "p1", memberIds: ["a", "b"] });
      const big = group({ id: "g-big", name: "Zeta", projectId: "p2", memberIds: ["a", "b", "c", "d", "q", "r", "s", "t"] });
      const out = suggestFiling({ attendeeIds: ["a", "b", "c", "d"], groups: [small, big], title: "Zeta sync" });
      expect(out.map((s) => s.groupId)).toEqual(["g-big", "g-small"]);
    });
  });
});

describe("suggestPairFiling", () => {
  const pairs = [
    { menteeId: "mia", menteeName: "Mia Chen" },
    { menteeId: "noa", menteeName: "Noa Park" },
  ];
  const base = { viewerId: "me", groupsInvited: false, pairs };

  it("names the mentee on a 1:1 with them", () => {
    expect(suggestPairFiling({ ...base, attendeeIds: ["mia"] })).toEqual({
      menteeId: "mia",
      label: "Mentorship · Mia Chen",
      reason: PAIR_REASON,
    });
  });

  it("reads the reason as your mentee", () => {
    expect(PAIR_REASON).toBe("your mentee");
  });

  it("ignores the viewer on the invite", () => {
    expect(suggestPairFiling({ ...base, attendeeIds: ["me", "noa"] })?.menteeId).toBe("noa");
  });

  it("counts each person once", () => {
    expect(suggestPairFiling({ ...base, attendeeIds: ["mia", "mia", "me"] })?.menteeId).toBe("mia");
  });

  it("is silent for a third person, a stranger, no one, or any invited group", () => {
    expect(suggestPairFiling({ ...base, attendeeIds: ["mia", "noa"] })).toBeNull();
    expect(suggestPairFiling({ ...base, attendeeIds: ["mia", "zed"] })).toBeNull();
    expect(suggestPairFiling({ ...base, attendeeIds: ["zed"] })).toBeNull();
    expect(suggestPairFiling({ ...base, attendeeIds: [] })).toBeNull();
    expect(suggestPairFiling({ ...base, attendeeIds: ["mia"], groupsInvited: true })).toBeNull();
  });

  it("is silent without any pairs", () => {
    expect(suggestPairFiling({ ...base, attendeeIds: ["mia"], pairs: [] })).toBeNull();
  });
});
