import { describe, it, expect } from "vitest";
import { formatPairPlan, planSplitFolds } from "~/lib/split-series-fold";
import type {
  FoldAttendance,
  FoldMeeting,
  FoldMeetingData,
  FoldNote,
  FoldTimeEntry,
} from "~/lib/split-series-fold";

const BASE_ID = "6b1uc1q7omn5duodshtuoohpts";
const RULE = "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261121T045959Z";

const d = (s: string) => new Date(s);
const OCT5 = d("2026-10-05T13:00:00Z");
const OCT12 = d("2026-10-12T13:00:00Z");
const OCT19 = d("2026-10-19T13:00:00Z");

function meeting(over: Partial<FoldMeeting> & { id: string }): FoldMeeting {
  return {
    title: "Domain Leads Meeting",
    externalEventId: null,
    iCalUID: null,
    status: "Confirmed",
    createdAt: d("2026-09-01T00:00:00Z"),
    selectedAt: d("2026-09-14T13:00:00Z"),
    durationMinutes: 60,
    recurrenceRule: RULE,
    notebookId: null,
    participantUserIds: [],
    ...over,
  };
}

const parentRow = (over: Partial<FoldMeeting> = {}) =>
  meeting({ id: "parent", externalEventId: BASE_ID, ...over });
const splitRow = (over: Partial<FoldMeeting> = {}) =>
  meeting({
    id: "split",
    externalEventId: `${BASE_ID}_R20260928T130000`,
    createdAt: d("2026-09-29T00:00:00Z"),
    selectedAt: d("2026-09-28T13:00:00Z"),
    ...over,
  });

const data = (over: Partial<FoldMeetingData> = {}): FoldMeetingData => ({
  notes: [],
  attendance: [],
  recordings: [],
  timeEntries: [],
  exceptions: [],
  ...over,
});

const note = (id: string, key: Date | null, over: Partial<FoldNote> = {}): FoldNote => ({
  id,
  key,
  archived: false,
  parentPageId: null,
  ...over,
});

const att = (id: string, userId: string, key: Date, over: Partial<FoldAttendance> = {}): FoldAttendance => ({
  id,
  userId,
  key,
  present: false,
  markedAt: null,
  markedByUserId: null,
  absenceNote: null,
  ...over,
});

const entry = (id: string, userId: string, key: Date | null): FoldTimeEntry => ({ id, userId, key });

const run = (meetings: FoldMeeting[], byId: Record<string, FoldMeetingData>) =>
  planSplitFolds(meetings, new Map(Object.entries(byId)));

const fold = (parent: FoldMeetingData, split: FoldMeetingData, parentOver = {}, splitOver = {}) => {
  const plan = run([parentRow(parentOver), splitRow(splitOver)], { parent, split });
  expect(plan.pairs).toHaveLength(1);
  return plan.pairs[0]!;
};

describe("grouping", () => {
  it("pairs one split with its parent", () => {
    const plan = run([parentRow(), splitRow()], {});
    expect(plan.orphans).toEqual([]);
    expect(plan.pairs.map((p) => [p.parentId, p.splitId])).toEqual([["parent", "split"]]);
  });

  it("folds two splits into one parent, oldest first", () => {
    const newer = splitRow({
      id: "split2",
      externalEventId: `${BASE_ID}_R20261012T130000`,
      createdAt: d("2026-10-13T00:00:00Z"),
    });
    const plan = run([newer, parentRow(), splitRow()], {});
    expect(plan.pairs.map((p) => p.splitId)).toEqual(["split", "split2"]);
    expect(new Set(plan.pairs.map((p) => p.parentId))).toEqual(new Set(["parent"]));
  });

  it("reports a split with no parent and plans nothing", () => {
    const plan = run([splitRow()], { split: data({ notes: [note("n1", OCT5)] }) });
    expect(plan.pairs).toEqual([]);
    expect(plan.orphans).toEqual([
      expect.objectContaining({ splitId: "split", reason: "no parent, skipped" }),
    ]);
  });

  it("finds the parent by iCalUID base when the event ids differ", () => {
    const plan = run(
      [
        parentRow({ externalEventId: "other", iCalUID: `${BASE_ID}@google.com` }),
        splitRow({ iCalUID: `${BASE_ID}_R20260928T130000@google.com` }),
      ],
      {},
    );
    expect(plan.pairs.map((p) => p.parentId)).toEqual(["parent"]);
  });

  it("ignores cancelled meetings as parents and as splits", () => {
    expect(run([parentRow({ status: "Cancelled" }), splitRow()], {}).orphans).toHaveLength(1);
    const plan = run([parentRow(), splitRow({ status: "Cancelled" })], {});
    expect(plan.pairs).toEqual([]);
    expect(plan.orphans).toEqual([]);
  });

  it("never treats another split as a parent", () => {
    const other = splitRow({ id: "other", externalEventId: `${BASE_ID}_R20261005T130000` });
    const plan = run([splitRow(), other], {});
    expect(plan.pairs).toEqual([]);
    expect(plan.orphans).toHaveLength(2);
  });
});

describe("eligibility", () => {
  it("folds when every data key is an occurrence of the parent rule", () => {
    const p = fold(data(), data({ notes: [note("n1", OCT5)], attendance: [att("a1", "u1", OCT12)] }));
    expect(p.skipReason).toBeNull();
  });

  it("keeps the rule across the Nov 2 DST change", () => {
    const keys = [d("2026-10-26T13:00:00Z"), d("2026-11-02T13:00:00Z"), d("2026-11-09T13:00:00Z")];
    const p = fold(data(), data({ recordings: keys.map((k, i) => ({ id: `r${i}`, key: k })) }));
    expect(p.skipReason).toBeNull();
    expect(p.recordingMoves).toEqual(["r0", "r1", "r2"]);
  });

  it("skips when a key is an hour off the rule", () => {
    const p = fold(data(), data({ notes: [note("n1", OCT5), note("n2", d("2026-11-09T14:00:00Z"))] }));
    expect(p.skipReason).toMatch(/^times differ, needs continuation/);
    expect(p.skipReason).toContain("2026-11-09T14:00:00.000Z");
    expect(p.skipReason).not.toContain("2026-10-05");
    expect(p.noteMoves).toEqual([]);
  });

  it("skips a key on a different weekday", () => {
    const p = fold(data(), data({ timeEntries: [entry("t1", "u1", d("2026-10-06T13:00:00Z"))] }));
    expect(p.skipReason).toMatch(/times differ/);
  });

  it("skips a key past the rule's UNTIL", () => {
    const p = fold(data(), data({ notes: [note("n1", d("2026-11-23T13:00:00Z"))] }));
    expect(p.skipReason).toMatch(/times differ/);
  });

  it("skips a key the parent cancelled by exception", () => {
    const p = fold(
      data({ exceptions: [{ originalStart: OCT12, overrideStart: null, overrideDurationMin: null, cancelled: true }] }),
      data({ notes: [note("n1", OCT12)] }),
    );
    expect(p.skipReason).toMatch(/times differ/);
  });

  it("skips when the split has MeetingException rows", () => {
    const p = fold(
      data(),
      data({
        notes: [note("n1", OCT5)],
        exceptions: [{ originalStart: OCT5, overrideStart: null, overrideDurationMin: null, cancelled: false }],
      }),
    );
    expect(p.skipReason).toMatch(/MeetingException/);
    expect(p.noteMoves).toEqual([]);
  });

  it("checks archived notes, attendance, recordings and time entries too", () => {
    const off = d("2026-10-05T14:00:00Z");
    for (const split of [
      data({ notes: [note("n1", off, { archived: true })] }),
      data({ attendance: [att("a1", "u1", off)] }),
      data({ recordings: [{ id: "r1", key: off }] }),
      data({ timeEntries: [entry("t1", "u1", off)] }),
    ]) {
      expect(fold(data(), split).skipReason).toMatch(/times differ/);
    }
  });

  it("ignores keyless rows when checking keys", () => {
    const p = fold(data(), data({ notes: [note("n1", null)], recordings: [{ id: "r1", key: null }] }));
    expect(p.skipReason).toBeNull();
    expect(p.noteMoves).toEqual([{ pageId: "n1", key: null }]);
    expect(p.recordingMoves).toEqual(["r1"]);
  });

  it("falls back to the split's own start when it holds no data", () => {
    expect(fold(data(), data()).skipReason).toBeNull();
    expect(fold(data(), data(), {}, { selectedAt: d("2026-09-28T15:00:00Z") }).skipReason).toMatch(/times differ/);
  });

  it("skips a parent with no start", () => {
    expect(fold(data(), data({ notes: [note("n1", OCT5)] }), { selectedAt: null }).skipReason).toMatch(/times differ/);
  });

  it("handles a one-off parent", () => {
    const parent = { recurrenceRule: null, selectedAt: OCT5 };
    expect(fold(data(), data({ notes: [note("n1", OCT5)] }), parent).skipReason).toBeNull();
    expect(fold(data(), data({ notes: [note("n1", OCT12)] }), parent).skipReason).toMatch(/times differ/);
  });

  it("skips one pair without blocking the other split", () => {
    const second = splitRow({ id: "split2", externalEventId: `${BASE_ID}_R20261012T130000`, createdAt: d("2026-10-13T00:00:00Z") });
    const plan = run([parentRow(), splitRow(), second], {
      split: data({ notes: [note("n1", d("2026-10-05T14:00:00Z"))] }),
      split2: data({ notes: [note("n2", OCT12)] }),
    });
    expect(plan.pairs.map((p) => p.skipReason === null)).toEqual([false, true]);
  });
});

describe("notes", () => {
  it("moves a split note when the parent has none at that key", () => {
    const p = fold(data({ notes: [note("pn", OCT19)] }), data({ notes: [note("n1", OCT5), note("n2", OCT12)] }));
    expect(p.noteMoves.map((m) => m.pageId)).toEqual(["n1", "n2"]);
    expect(p.noteDetaches).toEqual([]);
  });

  it("detaches a split note whose key the parent already holds live", () => {
    const p = fold(data({ notes: [note("pn", OCT12)] }), data({ notes: [note("n1", OCT12)] }));
    expect(p.noteMoves).toEqual([]);
    expect(p.noteDetaches).toEqual([{ pageId: "n1", key: OCT12, reason: "conflict" }]);
  });

  it("detaches archived split notes instead of moving them", () => {
    const p = fold(data(), data({ notes: [note("n1", OCT5, { archived: true })] }));
    expect(p.noteMoves).toEqual([]);
    expect(p.noteDetaches).toEqual([{ pageId: "n1", key: OCT5, reason: "archived" }]);
  });

  it("detaches an archived parent note at the key a split note moves onto", () => {
    const p = fold(data({ notes: [note("pa", OCT5, { archived: true })] }), data({ notes: [note("n1", OCT5)] }));
    expect(p.parentArchivedDetaches).toEqual([{ pageId: "pa", key: OCT5 }]);
    expect(p.noteMoves.map((m) => m.pageId)).toEqual(["n1"]);
  });

  it("leaves an archived parent note alone when nothing moves onto its key", () => {
    const p = fold(data({ notes: [note("pa", OCT5, { archived: true })] }), data({ notes: [note("n1", OCT12)] }));
    expect(p.parentArchivedDetaches).toEqual([]);
  });

  it("does not detach an archived parent note when the split note conflicts with a live one", () => {
    const parent = data({ notes: [note("pa", OCT5, { archived: true }), note("pl", OCT5)] });
    const p = fold(parent, data({ notes: [note("n1", OCT5)] }));
    expect(p.parentArchivedDetaches).toEqual([]);
    expect(p.noteDetaches[0]!.reason).toBe("conflict");
  });

  it("treats a note moved by an earlier split as the parent's when folding the next", () => {
    const second = splitRow({ id: "split2", externalEventId: `${BASE_ID}_R20261012T130000`, createdAt: d("2026-10-13T00:00:00Z") });
    const plan = run([parentRow(), splitRow(), second], {
      split: data({ notes: [note("n1", OCT5)] }),
      split2: data({ notes: [note("n2", OCT5)] }),
    });
    expect(plan.pairs[0]!.noteMoves.map((m) => m.pageId)).toEqual(["n1"]);
    expect(plan.pairs[1]!.noteDetaches).toEqual([{ pageId: "n2", key: OCT5, reason: "conflict" }]);
  });
});

describe("notebooks", () => {
  it("refiles moved notes into the parent's notebook when they sit elsewhere", () => {
    const p = fold(
      data(),
      data({ notes: [note("n1", OCT5, { parentPageId: "nbSplit" }), note("n2", OCT12, { parentPageId: "nbParent" })] }),
      { notebookId: "nbParent" },
      { notebookId: "nbSplit" },
    );
    expect(p.notebookMoves).toEqual([{ pageId: "n1", notebookId: "nbParent" }]);
    expect(p.parentNotebookId).toBeNull();
  });

  it("adopts the split's notebook when the parent has none", () => {
    const p = fold(data(), data({ notes: [note("n1", OCT5, { parentPageId: "nbSplit" })] }), {}, { notebookId: "nbSplit" });
    expect(p.parentNotebookId).toBe("nbSplit");
    expect(p.notebookMoves).toEqual([]);
  });

  it("refiles a note that sits outside the adopted notebook", () => {
    const p = fold(data(), data({ notes: [note("n1", OCT5, { parentPageId: "folder" })] }), {}, { notebookId: "nbSplit" });
    expect(p.notebookMoves).toEqual([{ pageId: "n1", notebookId: "nbSplit" }]);
  });

  it("does nothing when neither has a notebook", () => {
    const p = fold(data(), data({ notes: [note("n1", OCT5, { parentPageId: "folder" })] }));
    expect(p.parentNotebookId).toBeNull();
    expect(p.notebookMoves).toEqual([]);
  });

  it("does not refile detached notes", () => {
    const p = fold(
      data({ notes: [note("pn", OCT5)] }),
      data({ notes: [note("n1", OCT5, { parentPageId: "nbSplit" })] }),
      { notebookId: "nbParent" },
    );
    expect(p.notebookMoves).toEqual([]);
  });

  it("keeps the parent's notebook over the split's", () => {
    const p = fold(data(), data(), { notebookId: "nbParent" }, { notebookId: "nbSplit" });
    expect(p.parentNotebookId).toBeNull();
  });
});

describe("attendance", () => {
  it("moves a row the parent lacks, per user and key", () => {
    const p = fold(
      data({ attendance: [att("pa", "u1", OCT12)] }),
      data({ attendance: [att("a1", "u1", OCT5), att("a2", "u2", OCT12)] }),
    );
    expect(p.attendanceMoves).toEqual(["a1", "a2"]);
    expect(p.attendanceMerges).toEqual([]);
  });

  it("marks the parent row present when only the split row was", () => {
    const at = d("2026-10-12T13:02:00Z");
    const p = fold(
      data({ attendance: [att("pa", "u1", OCT12)] }),
      data({ attendance: [att("a1", "u1", OCT12, { present: true, markedAt: at, markedByUserId: "m1" })] }),
    );
    expect(p.attendanceMoves).toEqual([]);
    expect(p.attendanceMerges).toEqual([
      { parentRowId: "pa", splitRowId: "a1", set: { present: true, markedAt: at, markedByUserId: "m1" } },
    ]);
  });

  it("keeps the earliest markedAt when both were present", () => {
    const early = d("2026-10-12T13:01:00Z");
    const late = d("2026-10-12T13:09:00Z");
    const earlySplit = fold(
      data({ attendance: [att("pa", "u1", OCT12, { present: true, markedAt: late, markedByUserId: "p" })] }),
      data({ attendance: [att("a1", "u1", OCT12, { present: true, markedAt: early, markedByUserId: "s" })] }),
    );
    expect(earlySplit.attendanceMerges[0]!.set).toEqual({ markedAt: early, markedByUserId: "s" });
    const earlyParent = fold(
      data({ attendance: [att("pa", "u1", OCT12, { present: true, markedAt: early })] }),
      data({ attendance: [att("a1", "u1", OCT12, { present: true, markedAt: late })] }),
    );
    expect(earlyParent.attendanceMerges[0]!.set).toEqual({});
  });

  it("never downgrades a present parent row to the split's absent one", () => {
    const p = fold(
      data({ attendance: [att("pa", "u1", OCT12, { present: true, markedAt: OCT12 })] }),
      data({ attendance: [att("a1", "u1", OCT12)] }),
    );
    expect(p.attendanceMerges[0]!.set).toEqual({});
  });

  it("carries an absence note the parent lacks", () => {
    const p = fold(
      data({ attendance: [att("pa", "u1", OCT12)] }),
      data({ attendance: [att("a1", "u1", OCT12, { absenceNote: "travelling" })] }),
    );
    expect(p.attendanceMerges[0]!.set).toEqual({ absenceNote: "travelling" });
  });

  it("does not overwrite an existing absence note", () => {
    const p = fold(
      data({ attendance: [att("pa", "u1", OCT12, { absenceNote: "sick" })] }),
      data({ attendance: [att("a1", "u1", OCT12, { absenceNote: "travelling" })] }),
    );
    expect(p.attendanceMerges[0]!.set).toEqual({});
  });
});

describe("recordings and time entries", () => {
  it("moves every recording", () => {
    const p = fold(data(), data({ recordings: [{ id: "r1", key: OCT12 }, { id: "r2", key: null }] }));
    expect(p.recordingMoves).toEqual(["r1", "r2"]);
  });

  it("moves time entries the parent lacks", () => {
    const p = fold(data({ timeEntries: [entry("pt", "u1", OCT12)] }), data({ timeEntries: [entry("t1", "u1", OCT5), entry("t2", "u2", OCT12)] }));
    expect(p.timeEntryMoves).toEqual(["t1", "t2"]);
    expect(p.timeEntryConflicts).toEqual([]);
  });

  it("leaves a clashing time entry on the split and reports it", () => {
    const p = fold(data({ timeEntries: [entry("pt", "u1", OCT12)] }), data({ timeEntries: [entry("t1", "u1", OCT12)] }));
    expect(p.timeEntryMoves).toEqual([]);
    expect(p.timeEntryConflicts).toEqual([{ id: "t1", userId: "u1", key: OCT12 }]);
  });

  it("moves a keyless time entry", () => {
    const p = fold(data({ timeEntries: [entry("pt", "u1", null)] }), data({ timeEntries: [entry("t1", "u1", null)] }));
    expect(p.timeEntryMoves).toEqual(["t1"]);
  });
});

describe("participants", () => {
  it("unions and dedupes, keeping the parent's order first", () => {
    const p = fold(data(), data(), { participantUserIds: ["a", "b"] }, { participantUserIds: ["b", "c", "c"] });
    expect(p.participantUserIds).toEqual(["a", "b", "c"]);
  });

  it("leaves the list alone when the split adds nobody", () => {
    const p = fold(data(), data(), { participantUserIds: ["a", "b"] }, { participantUserIds: ["b"] });
    expect(p.participantUserIds).toBeNull();
  });
});

describe("formatPairPlan", () => {
  it("names the skip reason for a skipped pair", () => {
    const p = fold(data(), data({ notes: [note("n1", d("2026-10-05T14:00:00Z"))] }));
    expect(formatPairPlan(p)).toContain("SKIPPED: times differ, needs continuation");
  });

  it("summarises a fold", () => {
    const p = fold(data({ notes: [note("pn", OCT12)] }), data({ notes: [note("n1", OCT5), note("n2", OCT12)] }));
    const text = formatPairPlan(p);
    expect(text).toContain("parent");
    expect(text).toContain("notes moved: 2026-10-05T13:00:00.000Z");
    expect(text).toContain("notes detached (conflict): n2");
    expect(text).toContain("split row will be Cancelled");
  });
});

describe("Domain Leads fixture", () => {
  it("moves Oct 5 and Oct 12, keeps Oct 19, and cancels the split", () => {
    const parent = parentRow({
      id: "cmu5tijvi00ijj4s9a6gwd1z8",
      notebookId: null,
      participantUserIds: ["steph"],
    });
    const split = splitRow({
      id: "cmuueevyq01fkj4s9eijyeabu",
      notebookId: "nb-domain-leads",
      participantUserIds: ["steph", "sophie"],
    });
    const plan = run([parent, split], {
      cmu5tijvi00ijj4s9a6gwd1z8: data({
        notes: [note("note-oct19", OCT19)],
        attendance: [att("att-p-oct19", "steph", OCT19, { present: true })],
      }),
      cmuueevyq01fkj4s9eijyeabu: data({
        notes: [
          note("note-oct5", OCT5, { parentPageId: "nb-domain-leads" }),
          note("note-oct12", OCT12, { parentPageId: "nb-domain-leads" }),
        ],
        attendance: [
          att("att-oct5", "steph", OCT5, { present: true }),
          att("att-oct5-s", "sophie", OCT5, { present: true }),
          att("att-oct12", "steph", OCT12, { present: true }),
        ],
        recordings: [{ id: "rec-oct12", key: OCT12 }],
      }),
    });

    expect(plan.orphans).toEqual([]);
    const [p] = plan.pairs;
    expect(p).toMatchObject({
      parentId: "cmu5tijvi00ijj4s9a6gwd1z8",
      splitId: "cmuueevyq01fkj4s9eijyeabu",
      skipReason: null,
      parentNotebookId: "nb-domain-leads",
      notebookMoves: [],
      noteDetaches: [],
      attendanceMoves: ["att-oct5", "att-oct5-s", "att-oct12"],
      attendanceMerges: [],
      recordingMoves: ["rec-oct12"],
      participantUserIds: ["steph", "sophie"],
    });
    expect(p!.noteMoves.map((m) => m.pageId)).toEqual(["note-oct5", "note-oct12"]);
    expect(p!.noteMoves.map((m) => m.pageId)).not.toContain("note-oct19");
    expect(p!.keys).toEqual([OCT5, OCT12]);
  });
});
