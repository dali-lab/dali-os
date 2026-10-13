import { describe, it, expect } from "vitest";
import { suggestFiling } from "~/calendar/lib/suggest-filing";
import type { GroupOption } from "~/calendar/lib/types";

const group = (over: Partial<GroupOption> & { id: string; name: string }): GroupOption => ({
  memberIds: [],
  projectId: null,
  systemKey: null,
  ...over,
});

const atlas = group({ id: "g-atlas", name: "Atlas", projectId: "p-atlas", memberIds: ["a", "b", "c", "d", "e"] });
const core = group({ id: "g-core", name: "Core", systemKey: "core", memberIds: ["a", "b", "x", "y"] });
const offering = group({ id: "g-off", name: "Intro to Design", systemKey: "offering:o1", memberIds: ["a", "b", "s1"] });
const plain = group({ id: "g-plain", name: "Everyone", memberIds: ["a", "b", "c", "d"] });

describe("suggestFiling", () => {
  it("suggests nothing with no groups", () => {
    expect(suggestFiling({ attendeeIds: ["a", "b"], groups: [], title: "Sync" })).toEqual([]);
  });

  it("suggests nothing for empty attendees and a title that names nothing", () => {
    expect(suggestFiling({ attendeeIds: [], groups: [atlas, core, offering], title: "Weekly" })).toEqual([]);
  });

  it("still matches a title when there are no attendees, without dividing by zero", () => {
    const out = suggestFiling({ attendeeIds: [], groups: [atlas], title: "Atlas kickoff" });
    expect(out).toEqual([
      { groupId: "g-atlas", label: "Atlas", kind: "project", score: 0.5, reason: "named in the title" },
    ]);
  });

  it("ignores groups that are neither project, Core nor offering", () => {
    expect(suggestFiling({ attendeeIds: ["a", "b", "c", "d"], groups: [plain], title: "Everyone" })).toEqual([]);
  });

  it("scores the share of attendees on the roster and explains it", () => {
    expect(suggestFiling({ attendeeIds: ["a", "b", "c", "z"], groups: [atlas], title: "Sync" })).toEqual([
      { groupId: "g-atlas", label: "Atlas", kind: "project", score: 0.75, reason: "3 of 4 attendees" },
    ]);
  });

  it("uses the singular for a lone attendee", () => {
    const out = suggestFiling({ attendeeIds: ["a"], groups: [atlas], title: "Atlas" });
    expect(out[0]!.reason).toBe("1 of 1 attendee · named in the title");
  });

  it("counts each attendee and each member once", () => {
    const dup = group({ id: "g", name: "Dupes", projectId: "p", memberIds: ["a", "a", "b", "b"] });
    const out = suggestFiling({ attendeeIds: ["a", "a", "b", "z"], groups: [dup], title: "Sync" });
    expect(out[0]).toMatchObject({ score: 2 / 3, reason: "2 of 3 attendees" });
  });

  describe("roster threshold", () => {
    it("keeps exactly half with two people", () => {
      const out = suggestFiling({ attendeeIds: ["a", "b", "z", "w"], groups: [atlas], title: "Sync" });
      expect(out.map((s) => s.score)).toEqual([0.5]);
    });

    it("drops anything under half, even with two people", () => {
      expect(suggestFiling({ attendeeIds: ["a", "b", "z", "w", "v"], groups: [atlas], title: "Sync" })).toEqual([]);
    });

    it("drops a single-person overlap even at a perfect share", () => {
      expect(suggestFiling({ attendeeIds: ["a"], groups: [atlas], title: "Sync" })).toEqual([]);
    });
  });

  describe("title match", () => {
    it("adds 0.5 for a project name in the title, case-insensitively", () => {
      const out = suggestFiling({ attendeeIds: ["a", "b", "c", "d"], groups: [atlas], title: "ATLAS standup" });
      expect(out[0]).toMatchObject({ score: 1.5, reason: "4 of 4 attendees · named in the title" });
    });

    it("keeps a title match with no roster overlap", () => {
      const out = suggestFiling({ attendeeIds: ["z"], groups: [atlas], title: "Atlas planning" });
      expect(out[0]).toMatchObject({ groupId: "g-atlas", score: 0.5, reason: "named in the title" });
    });

    it("keeps a title match with one overlapping person", () => {
      const out = suggestFiling({ attendeeIds: ["a", "z", "y", "w"], groups: [atlas], title: "Atlas planning" });
      expect(out[0]).toMatchObject({ score: 0.75, reason: "1 of 4 attendees · named in the title" });
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

    it("names an offering in the title", () => {
      const out = suggestFiling({ attendeeIds: ["z"], groups: [offering], title: "Intro to Design office hours" });
      expect(out[0]).toMatchObject({ kind: "offering", label: "Intro to Design", score: 0.5 });
    });
  });

  describe("Core", () => {
    it("is a candidate on roster overlap alone", () => {
      const out = suggestFiling({ attendeeIds: ["a", "b", "x", "q"], groups: [core], title: "Sync" });
      expect(out).toEqual([{ groupId: "g-core", label: "Core", kind: "core", score: 0.75, reason: "3 of 4 attendees" }]);
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

  describe("offerings", () => {
    it("recognises an offering by group id prefix as well as system key", () => {
      const byId = group({ id: "offering:o9", name: "Studio", memberIds: ["a", "b"] });
      expect(suggestFiling({ attendeeIds: ["a", "b"], groups: [byId], title: "Sync" })[0]!.kind).toBe("offering");
    });
  });

  describe("ordering", () => {
    it("returns the top two by score", () => {
      const out = suggestFiling({
        attendeeIds: ["a", "b", "c", "d"],
        groups: [core, offering, atlas],
        title: "Sync",
      });
      expect(out.map((s) => s.groupId)).toEqual(["g-atlas", "g-core"]);
    });

    it("never returns more than two", () => {
      const many = Array.from({ length: 5 }, (_, i) =>
        group({ id: `g${i}`, name: `Project ${i}`, projectId: `p${i}`, memberIds: ["a", "b"] }),
      );
      expect(suggestFiling({ attendeeIds: ["a", "b"], groups: many, title: "Sync" })).toHaveLength(2);
    });

    it("breaks score ties by larger overlap, then name, then id", () => {
      const rosterOnly = group({ id: "g-roster", name: "Zeta", projectId: "p1", memberIds: ["a", "b"] });
      const titleOnly = group({ id: "g-title", name: "Alpha", projectId: "p2" });
      const out = suggestFiling({ attendeeIds: ["a", "b", "y", "z"], groups: [titleOnly, rosterOnly], title: "Alpha sync" });
      expect(out.map((s) => s.score)).toEqual([0.5, 0.5]);
      expect(out.map((s) => s.groupId)).toEqual(["g-roster", "g-title"]);

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

    it("ranks a title match above a bare roster hit", () => {
      const named = group({ id: "g-named", name: "Orbit", projectId: "p9", memberIds: ["a"] });
      const out = suggestFiling({ attendeeIds: ["a", "b", "y", "z"], groups: [atlas, named], title: "Orbit review" });
      expect(out.map((s) => [s.groupId, s.score])).toEqual([
        ["g-named", 0.75],
        ["g-atlas", 0.5],
      ]);
    });
  });
});
