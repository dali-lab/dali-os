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
});

describe("matchRosterOwner", () => {
  it("returns null for an empty roster", () => {
    expect(matchRosterOwner("Ada Lovelace", [])).toBeNull();
  });

  it("is case-insensitive on an exact match", () => {
    expect(matchRosterOwner("ada lovelace", [{ userId: "u1", name: "Ada Lovelace" }])).toBe("u1");
  });
});
