import { describe, expect, it } from "vitest";
import {
  buildRecap,
  channelAudience,
  groupRecapsByWeek,
  isoWeekKey,
  isStaleDraft,
  recapIsEmpty,
  recapPost,
  recapSendMoment,
  releaseNotePost,
  shouldRunRecap,
  slackEscape,
  STALE_DRAFT_MS,
  viewerAudience,
  type RecapNote,
} from "../release-notes-recap";

const note = (o: Partial<RecapNote> & { id: string }): RecapNote => ({
  title: `Title ${o.id}`,
  summary: `Summary ${o.id}`,
  area: null,
  highlight: false,
  allMembers: true,
  groupIds: [],
  ...o,
});

describe("isoWeekKey (America/New_York)", () => {
  it("labels a mid-year Thursday", () => {
    expect(isoWeekKey(new Date("2026-10-22T15:00:00Z"))).toBe("2026-W43");
  });

  it("treats Sunday as the last day of the ISO week", () => {
    expect(isoWeekKey(new Date("2026-10-25T16:00:00Z"))).toBe("2026-W43");
    expect(isoWeekKey(new Date("2026-10-26T16:00:00Z"))).toBe("2026-W44");
  });

  it("rolls Jan 1 2027 (a Friday) back into 2026-W53", () => {
    expect(isoWeekKey(new Date("2027-01-01T17:00:00Z"))).toBe("2026-W53");
    expect(isoWeekKey(new Date("2027-01-04T17:00:00Z"))).toBe("2027-W01");
  });

  it("rolls Dec 29 2025 into 2026-W01", () => {
    expect(isoWeekKey(new Date("2025-12-29T17:00:00Z"))).toBe("2026-W01");
  });

  it("uses the ET date, not UTC, near midnight", () => {
    // 2026-10-26 02:00 UTC is still Sunday Oct 25 in ET (EDT).
    expect(isoWeekKey(new Date("2026-10-26T02:00:00Z"))).toBe("2026-W43");
    // 2027-01-01 03:00 UTC is Dec 31 2026 in ET.
    expect(isoWeekKey(new Date("2027-01-01T03:00:00Z"))).toBe("2026-W53");
  });

  it("is stable across the fall DST change", () => {
    expect(isoWeekKey(new Date("2026-11-01T04:30:00Z"))).toBe("2026-W44");
    expect(isoWeekKey(new Date("2026-11-01T06:30:00Z"))).toBe("2026-W44");
  });
});

describe("recapSendMoment", () => {
  it("is Thursday 10:00 EDT in October", () => {
    expect(recapSendMoment(new Date("2026-10-21T12:00:00Z"), 4, 10).toISOString()).toBe(
      "2026-10-22T14:00:00.000Z",
    );
  });

  it("is Thursday 10:00 EST in December", () => {
    expect(recapSendMoment(new Date("2026-12-09T12:00:00Z"), 4, 10).toISOString()).toBe(
      "2026-12-10T15:00:00.000Z",
    );
  });

  it("stays on the correct day in the DST-change week", () => {
    expect(recapSendMoment(new Date("2026-11-02T12:00:00Z"), 4, 10).toISOString()).toBe(
      "2026-11-05T15:00:00.000Z",
    );
  });

  it("counts Sunday (0) as the end of the ISO week", () => {
    expect(recapSendMoment(new Date("2026-10-21T12:00:00Z"), 0, 9).toISOString()).toBe(
      "2026-10-25T13:00:00.000Z",
    );
  });
});

describe("shouldRunRecap", () => {
  const schedule = { weekday: 4, hour: 10 };

  it("waits on the right day before the hour", () => {
    expect(shouldRunRecap(new Date("2026-10-22T13:59:00Z"), null, schedule)).toBe(false);
  });

  it("runs at the hour on the right day", () => {
    expect(shouldRunRecap(new Date("2026-10-22T14:00:00Z"), null, schedule)).toBe(true);
  });

  it("waits before the weekday arrives", () => {
    expect(shouldRunRecap(new Date("2026-10-21T20:00:00Z"), null, schedule)).toBe(false);
  });

  it("catches up after the weekday if it has not run this week", () => {
    expect(
      shouldRunRecap(new Date("2026-10-23T20:00:00Z"), new Date("2026-10-15T14:05:00Z"), schedule),
    ).toBe(true);
  });

  it("does not run again once it ran this week", () => {
    expect(
      shouldRunRecap(new Date("2026-10-22T18:00:00Z"), new Date("2026-10-22T14:01:00Z"), schedule),
    ).toBe(false);
    expect(
      shouldRunRecap(new Date("2026-10-24T18:00:00Z"), new Date("2026-10-22T14:01:00Z"), schedule),
    ).toBe(false);
  });

  it("treats a not-due tick before the moment as not having run", () => {
    expect(
      shouldRunRecap(new Date("2026-10-22T14:15:00Z"), new Date("2026-10-22T13:45:00Z"), schedule),
    ).toBe(true);
  });

  it("runs again the next week", () => {
    expect(
      shouldRunRecap(new Date("2026-10-29T14:00:00Z"), new Date("2026-10-22T14:01:00Z"), schedule),
    ).toBe(true);
  });
});

describe("isStaleDraft", () => {
  const now = new Date("2026-10-22T14:00:00Z");

  it("is not stale at exactly 7 days", () => {
    expect(isStaleDraft(new Date(now.getTime() - STALE_DRAFT_MS), now)).toBe(false);
  });

  it("is stale one millisecond past 7 days", () => {
    expect(isStaleDraft(new Date(now.getTime() - STALE_DRAFT_MS - 1), now)).toBe(true);
  });

  it("is not stale when fresh", () => {
    expect(isStaleDraft(new Date(now.getTime() - 1000), now)).toBe(false);
  });
});

describe("buildRecap", () => {
  const notes = [
    note({ id: "a", area: "drive" }),
    note({ id: "b", area: "calendar", highlight: true }),
    note({ id: "c", area: "calendar" }),
    note({ id: "d", area: null }),
    note({ id: "e", area: "drive", allMembers: false, groupIds: ["g1"] }),
  ];
  const drafts = [
    { title: "Old thing", allMembers: true, groupIds: [] },
    { title: "Hidden thing", allMembers: false, groupIds: ["g1"] },
  ];

  it("puts highlights first and out of the area groups", () => {
    const r = buildRecap(notes, [], channelAudience);
    expect(r.highlights.map((n) => n.id)).toEqual(["b"]);
    expect(r.byArea.flatMap((g) => g.notes.map((n) => n.id))).not.toContain("b");
  });

  it("groups by area in nav order with unassigned last", () => {
    const r = buildRecap(notes, [], channelAudience);
    expect(r.byArea.map((g) => [g.label, g.notes.map((n) => n.id)])).toEqual([
      ["Calendar", ["c"]],
      ["Drive", ["a"]],
      ["Other", ["d"]],
    ]);
  });

  it("keeps group-restricted notes and drafts out of the channel recap", () => {
    const r = buildRecap(notes, drafts, channelAudience);
    expect(r.byArea.flatMap((g) => g.notes.map((n) => n.id))).not.toContain("e");
    expect(r.alsoShipped).toEqual(["Old thing"]);
  });

  it("includes a restricted note for a viewer in the group and not for others", () => {
    const inGroup = buildRecap(notes, [], viewerAudience({ isCore: false, groupIds: ["g1"] }));
    const outside = buildRecap(notes, [], viewerAudience({ isCore: false, groupIds: [] }));
    const ids = (r: ReturnType<typeof buildRecap>) => r.byArea.flatMap((g) => g.notes.map((n) => n.id));
    expect(ids(inGroup)).toContain("e");
    expect(ids(outside)).not.toContain("e");
  });

  it("shows Core everything", () => {
    const r = buildRecap(notes, drafts, viewerAudience({ isCore: true, groupIds: [] }));
    expect(r.alsoShipped).toEqual(["Old thing", "Hidden thing"]);
    expect(r.byArea.flatMap((g) => g.notes).length).toBe(4);
  });

  it("reports empty only when all three sections are empty", () => {
    expect(recapIsEmpty(buildRecap([], [], channelAudience))).toBe(true);
    expect(recapIsEmpty(buildRecap([], drafts, channelAudience))).toBe(false);
  });
});

describe("groupRecapsByWeek", () => {
  const viewer = { isCore: false, groupIds: [] };
  it("orders weeks newest first, skips unrecapped notes and weeks with nothing visible", () => {
    const weeks = groupRecapsByWeek(
      [
        { ...note({ id: "a" }), recapWeek: "2026-W42" },
        { ...note({ id: "b" }), recapWeek: "2026-W43" },
        { ...note({ id: "c" }), recapWeek: null },
        { ...note({ id: "d", allMembers: false, groupIds: ["g1"] }), recapWeek: "2026-W41" },
      ],
      viewer,
    );
    expect(weeks.map((w) => w.week)).toEqual(["2026-W43", "2026-W42"]);
  });

  it("orders across a year boundary", () => {
    const weeks = groupRecapsByWeek(
      [
        { ...note({ id: "a" }), recapWeek: "2026-W53" },
        { ...note({ id: "b" }), recapWeek: "2027-W01" },
      ],
      viewer,
    );
    expect(weeks.map((w) => w.week)).toEqual(["2027-W01", "2026-W53"]);
  });

  it("shows Core the restricted week", () => {
    const weeks = groupRecapsByWeek(
      [{ ...note({ id: "d", allMembers: false, groupIds: ["g1"] }), recapWeek: "2026-W41" }],
      { isCore: true, groupIds: [] },
    );
    expect(weeks.map((w) => w.week)).toEqual(["2026-W41"]);
  });
});

describe("Block Kit builders", () => {
  const base = "https://os.example";

  it("builds a per-entry post with area, bold title, summary and an Open button", () => {
    const post = releaseNotePost(
      note({ id: "n1", title: "Room holds", summary: "Hold rooms.", area: "calendar" }),
      base,
    );
    expect(post.text).toBe("Room holds");
    expect(post.blocks).toEqual([
      { type: "context", elements: [{ type: "mrkdwn", text: "Calendar" }] },
      { type: "section", text: { type: "mrkdwn", text: "*Room holds*\nHold rooms." } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open" },
            url: "https://os.example/release-notes/n1",
            action_id: "release_note_open",
          },
        ],
      },
    ]);
  });

  it("prefixes highlights with New: and omits the area line when unset", () => {
    const post = releaseNotePost(note({ id: "n1", highlight: true }), base);
    expect(post.text).toBe("New: Title n1");
    expect(post.blocks[0]).toMatchObject({ type: "section" });
    expect(JSON.stringify(post.blocks[0])).toContain("*New: Title n1*");
  });

  it("escapes Slack control characters", () => {
    expect(slackEscape("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
    const post = releaseNotePost(note({ id: "n1", title: "<!channel> hi" }), base);
    expect(JSON.stringify(post.blocks)).not.toContain("<!channel>");
  });

  it("builds a recap with highlights, area lists, then also shipped", () => {
    const recap = buildRecap(
      [
        note({ id: "h", highlight: true, area: "drive" }),
        note({ id: "x", area: "calendar" }),
      ],
      [{ title: "Old thing", allMembers: true, groupIds: [] }],
      channelAudience,
    );
    const post = recapPost(recap, "2026-W43", base);
    expect(post.text).toBe("What shipped this week (2026-W43)");
    const texts = post.blocks.map((b) =>
      b.type === "header" ? b.text.text : b.type === "section" ? (b.text?.text ?? "") : "",
    );
    expect(texts).toEqual([
      "What shipped this week",
      "*<https://os.example/release-notes/h|Title h>*\nSummary h",
      "*Calendar*\n• <https://os.example/release-notes/x|Title x>",
      "*Also shipped*\n• Old thing",
    ]);
  });

  it("omits the also shipped block when there are no stale drafts", () => {
    const recap = buildRecap([note({ id: "x" })], [], channelAudience);
    expect(JSON.stringify(recapPost(recap, "2026-W43", base).blocks)).not.toContain("Also shipped");
  });
});
