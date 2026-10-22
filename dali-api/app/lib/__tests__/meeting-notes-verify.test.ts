import { describe, expect, it } from "vitest";
import { matchRosterOwner, verifyEnhancePlan } from "~/lib/meeting-notes-verify";
import type { EnhancePlan } from "~/components/meeting-recorder/enhance-plan";

const lines = [
  { at: 100, text: "We decided to drop the admin dashboard from v1." },
  { at: 200, text: "Ada will send the partner the revised scope by Friday." },
];

describe("verifyEnhancePlan", () => {
  it("keeps a keep op untouched", () => {
    const plan: EnhancePlan = { blocks: [{ id: "b1", op: "keep" }], actionItems: [] };
    const { plan: out, verified } = verifyEnhancePlan(plan, lines, []);
    expect(out.blocks).toEqual([{ id: "b1", op: "keep" }]);
    expect(verified).toEqual({ droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 });
  });

  it("drops a cite more than 2s from any transcript line, but keeps the expand block", () => {
    const plan: EnhancePlan = {
      blocks: [{ id: "b1", op: "expand", text: "Dropped the dashboard.", cites: [100, 500] }],
      actionItems: [],
    };
    const { plan: out, verified } = verifyEnhancePlan(plan, lines, []);
    expect(out.blocks).toEqual([{ id: "b1", op: "expand", text: "Dropped the dashboard.", cites: [100] }]);
    expect(verified.droppedCites).toBe(1);
  });

  it("keeps a cite within the 2s tolerance", () => {
    const plan: EnhancePlan = {
      blocks: [{ id: "b1", op: "expand", text: "x", cites: [101.5] }],
      actionItems: [],
    };
    const { plan: out } = verifyEnhancePlan(plan, lines, []);
    expect(out.blocks[0]).toMatchObject({ cites: [101.5] });
  });

  it("drops an inserted block with no surviving cite", () => {
    const plan: EnhancePlan = {
      blocks: [{ op: "insert", after: "b1", type: "bullet", text: "Invented detail", cites: [9999] }],
      actionItems: [],
    };
    const { plan: out, verified } = verifyEnhancePlan(plan, lines, []);
    expect(out.blocks).toEqual([]);
    expect(verified.droppedBlocks).toBe(1);
    expect(verified.droppedCites).toBe(1);
  });

  it("drops an inserted block whose text shares no content word with its cited line", () => {
    const plan: EnhancePlan = {
      blocks: [{ op: "insert", after: "b1", type: "bullet", text: "Totally unrelated weather talk", cites: [100] }],
      actionItems: [],
    };
    const { plan: out, verified } = verifyEnhancePlan(plan, lines, []);
    expect(out.blocks).toEqual([]);
    expect(verified.droppedBlocks).toBe(1);
    expect(verified.droppedCites).toBe(0);
  });

  it("keeps an inserted block that shares a content word with its cited line", () => {
    const plan: EnhancePlan = {
      blocks: [{ op: "insert", after: "b1", type: "bullet", text: "Dropped the dashboard for v1", cites: [100] }],
      actionItems: [],
    };
    const { plan: out, verified } = verifyEnhancePlan(plan, lines, []);
    expect(out.blocks).toHaveLength(1);
    expect(verified.droppedBlocks).toBe(0);
  });

  it("ignores stopwords and short words when checking content-word overlap", () => {
    // "that", "will", "this" are stopwords; "the" is < 4 letters. No real
    // overlap with line[0]'s content words should still drop the block.
    const plan: EnhancePlan = {
      blocks: [{ op: "insert", after: "b1", type: "bullet", text: "That will be the this plan", cites: [100] }],
      actionItems: [],
    };
    const { verified } = verifyEnhancePlan(plan, lines, []);
    expect(verified.droppedBlocks).toBe(1);
  });

  it("resolves an exact-match owner name to a roster user id", () => {
    const plan: EnhancePlan = {
      blocks: [],
      actionItems: [{ text: "Send scope", ownerName: "Ada Lovelace", cites: [200] }],
    };
    const roster = [{ userId: "u1", name: "Ada Lovelace" }];
    const { plan: out, verified } = verifyEnhancePlan(plan, lines, roster);
    expect(out.actionItems[0]!.ownerUserId).toBe("u1");
    expect(verified.unmatchedOwners).toBe(0);
  });

  it("resolves an abbreviated owner name (first name + last initial) to the roster", () => {
    const plan: EnhancePlan = {
      blocks: [],
      actionItems: [{ text: "Send scope", ownerName: "Ada L", cites: [200] }],
    };
    const roster = [{ userId: "u1", name: "Ada Lovelace" }];
    const { plan: out } = verifyEnhancePlan(plan, lines, roster);
    expect(out.actionItems[0]!.ownerUserId).toBe("u1");
  });

  it("flags an owner name with no roster match", () => {
    const plan: EnhancePlan = {
      blocks: [],
      actionItems: [{ text: "Send scope", ownerName: "Someone Else", cites: [200] }],
    };
    const roster = [{ userId: "u1", name: "Ada Lovelace" }];
    const { plan: out, verified } = verifyEnhancePlan(plan, lines, roster);
    expect(out.actionItems[0]!.ownerUserId).toBeNull();
    expect(verified.unmatchedOwners).toBe(1);
  });

  it("doesn't count a missing owner name as unmatched", () => {
    const plan: EnhancePlan = { blocks: [], actionItems: [{ text: "Send scope", cites: [200] }] };
    const { verified } = verifyEnhancePlan(plan, lines, [{ userId: "u1", name: "Ada Lovelace" }]);
    expect(verified.unmatchedOwners).toBe(0);
  });

  it("drops an action item's out-of-range cite without dropping the item", () => {
    const plan: EnhancePlan = { blocks: [], actionItems: [{ text: "Send scope", cites: [200, 9999] }] };
    const { plan: out, verified } = verifyEnhancePlan(plan, lines, []);
    expect(out.actionItems).toEqual([{ text: "Send scope", cites: [200], ownerUserId: null }]);
    expect(verified.droppedCites).toBe(1);
  });

  describe("expand against the snapshot", () => {
    const snapshot = [{ id: "b1", type: "bulletListItem", text: "Admin dashboard" }];
    const expand = (text: string, cites = [100]): EnhancePlan => ({
      blocks: [{ id: "b1", op: "expand", text, cites }],
      actionItems: [],
    });

    it("turns an expand whose text matches the original into a keep, without counting it as dropped", () => {
      const { plan: out, verified } = verifyEnhancePlan(expand("Admin dashboard"), lines, [], null, snapshot);
      expect(out.blocks).toEqual([{ id: "b1", op: "keep" }]);
      expect(verified.droppedBlocks).toBe(0);
    });

    it("treats punctuation, case, and filler-only changes as no change", () => {
      const { plan: out, verified } = verifyEnhancePlan(
        expand("admin dashboard, which was also that."),
        lines,
        [],
        null,
        snapshot,
      );
      expect(out.blocks).toEqual([{ id: "b1", op: "keep" }]);
      expect(verified.droppedBlocks).toBe(0);
    });

    it("keeps an expand that adds a word from its cited line", () => {
      const text = "Admin dashboard: decided to drop it from v1.";
      const { plan: out, verified } = verifyEnhancePlan(expand(text), lines, [], null, snapshot);
      expect(out.blocks).toEqual([{ id: "b1", op: "expand", text, cites: [100] }]);
      expect(verified.droppedBlocks).toBe(0);
    });

    it("keeps an expand whose only addition is a number from its cited line", () => {
      const numLines = [{ at: 100, text: "The dashboard budget is 40 hours." }];
      const snap = [{ id: "b1", type: "paragraph", text: "Dashboard budget" }];
      const { plan: out } = verifyEnhancePlan(expand("Dashboard budget: 40"), numLines, [], null, snap);
      expect(out.blocks[0]).toMatchObject({ op: "expand", text: "Dashboard budget: 40" });
    });

    it("turns an expand whose additions its cited lines don't support into a keep and counts it", () => {
      const { plan: out, verified } = verifyEnhancePlan(
        expand("Admin dashboard ships in March with Stripe billing"),
        lines,
        [],
        null,
        snapshot,
      );
      expect(out.blocks).toEqual([{ id: "b1", op: "keep" }]);
      expect(verified.droppedBlocks).toBe(1);
    });

    it("turns an expand with no surviving cite into a keep and counts it", () => {
      const { plan: out, verified } = verifyEnhancePlan(
        expand("Admin dashboard: decided to drop it", [9999]),
        lines,
        [],
        null,
        snapshot,
      );
      expect(out.blocks).toEqual([{ id: "b1", op: "keep" }]);
      expect(verified).toMatchObject({ droppedBlocks: 1, droppedCites: 1 });
    });

    it("leaves an expand for a block missing from the snapshot to the client merge", () => {
      const { plan: out } = verifyEnhancePlan(expand("Anything"), lines, [], null, []);
      expect(out.blocks[0]).toMatchObject({ op: "expand", text: "Anything" });
    });
  });

  // Owners were getting matched to the wrong roster member (specs/meeting-
  // notes-model.md §6): a roster-name match alone is no longer enough.
  describe("owner evidence (specs/meeting-notes-model.md §6)", () => {
    it("rejects a roster match with no evidence near the cited line (a substituted name)", () => {
      const subLines = [{ at: 100, text: "Someone will handle onboarding next week.", channel: "call" as const }];
      const plan: EnhancePlan = {
        blocks: [],
        actionItems: [{ text: "Handle onboarding", ownerName: "Alex", cites: [100] }],
      };
      const roster = [{ userId: "u-alex", name: "Alex Kim" }];
      const { plan: out, verified } = verifyEnhancePlan(plan, subLines, roster, "u-alex");
      expect(out.actionItems[0]!.ownerUserId).toBeNull();
      expect(out.actionItems[0]!.ownerName).toBe("Alex");
      expect(verified.unmatchedOwners).toBe(1);
    });

    it("accepts a spoken first name whose evidence is on the cited line itself", () => {
      const spokenLines = [{ at: 100, text: "Sophie will own the partner follow-up.", channel: "call" as const }];
      const plan: EnhancePlan = {
        blocks: [],
        actionItems: [{ text: "Partner follow-up", ownerName: "Sophie", cites: [100] }],
      };
      const roster = [
        { userId: "u-soph", name: "Sophie Chen" },
        { userId: "u-steph", name: "Stephanie Diaz" },
      ];
      const { plan: out, verified } = verifyEnhancePlan(plan, spokenLines, roster, "u-steph");
      expect(out.actionItems[0]!.ownerUserId).toBe("u-soph");
      expect(verified.unmatchedOwners).toBe(0);
    });

    it("accepts a first-person ('I'll ...') item attributed to the recorder via mic-channel evidence", () => {
      const micLines = [{ at: 50, text: "I'll send the revised scope by Monday.", channel: "mic" as const }];
      const plan: EnhancePlan = {
        blocks: [],
        actionItems: [{ text: "Send the revised scope", ownerName: "Jordan", cites: [50] }],
      };
      const roster = [{ userId: "u-rec", name: "Jordan Lee" }];
      const { plan: out, verified } = verifyEnhancePlan(plan, micLines, roster, "u-rec");
      expect(out.actionItems[0]!.ownerUserId).toBe("u-rec");
      expect(verified.unmatchedOwners).toBe(0);
    });

    it("does not credit mic-channel evidence to anyone but the recorder", () => {
      const micLines = [{ at: 50, text: "I'll send the revised scope by Monday.", channel: "mic" as const }];
      const plan: EnhancePlan = {
        blocks: [],
        actionItems: [{ text: "Send the revised scope", ownerName: "Jordan", cites: [50] }],
      };
      const roster = [{ userId: "u-jordan", name: "Jordan Lee" }];
      // The recorder is someone else — "I'll" on their mic can't be Jordan.
      const { plan: out, verified } = verifyEnhancePlan(plan, micLines, roster, "u-someone-else");
      expect(out.actionItems[0]!.ownerUserId).toBeNull();
      expect(verified.unmatchedOwners).toBe(1);
    });
  });
});

describe("matchRosterOwner", () => {
  it("returns null for an empty roster", () => {
    expect(matchRosterOwner("Ada Lovelace", [])).toBeNull();
  });

  it("is case-insensitive on an exact match", () => {
    expect(matchRosterOwner("ada lovelace", [{ userId: "u1", name: "Ada Lovelace" }])).toBe("u1");
  });
});
