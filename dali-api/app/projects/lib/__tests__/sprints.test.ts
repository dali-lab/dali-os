import { describe, it, expect } from "vitest";
import {
  backfillPlacement,
  defaultAnchorDay,
  defaultBoardSprint,
  deriveEpicStatus,
  epicSprintSpan,
  isCarriedOnClose,
  planSprints,
  remapByOverlap,
  sprintStatus,
  type BackfillSprint,
} from "../sprints";
import { DAY } from "../timeline-days";

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// 26F: Wed 2026-09-16 → Tue 2026-11-24 (ten weeks less a day).
const FALL = { startsOn: d("2026-09-16"), endsOn: d("2026-11-24") };

describe("defaultAnchorDay", () => {
  it("is the term start's UTC weekday", () => {
    expect(defaultAnchorDay(d("2026-09-16"))).toBe(3);
    expect(defaultAnchorDay(d("2026-09-14"))).toBe(1);
  });

  it("ignores a local-midnight offset on the term start", () => {
    expect(defaultAnchorDay(Date.parse("2026-09-16T04:00:00Z"))).toBe(3);
  });
});

describe("planSprints", () => {
  it("defaults to the term-start weekday, giving full weeks from day one", () => {
    const sprints = planSprints(FALL, null);
    expect(sprints).toHaveLength(10);
    expect(iso(sprints[0]!.startsOn)).toBe("2026-09-16");
    expect(iso(sprints[0]!.endsOn)).toBe("2026-09-22");
    expect(sprints.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("truncates the final sprint at the term end", () => {
    const last = planSprints(FALL, null).at(-1)!;
    expect(iso(last.startsOn)).toBe("2026-11-18");
    expect(iso(last.endsOn)).toBe("2026-11-24");
    const short = planSprints({ startsOn: FALL.startsOn, endsOn: d("2026-11-20") }, null).at(-1)!;
    expect(iso(short.endsOn)).toBe("2026-11-20");
    expect((short.endsOn - short.startsOn) / DAY + 1).toBe(3);
  });

  it("starts Sprint 1 on the first anchor day on or after the term start", () => {
    // Monday anchor on a Wednesday-start term: Wed/Thu/Fri/Sat/Sun belong to no sprint.
    const sprints = planSprints(FALL, 1);
    expect(iso(sprints[0]!.startsOn)).toBe("2026-09-21");
    expect(iso(sprints[0]!.endsOn)).toBe("2026-09-27");
    expect(iso(sprints.at(-1)!.startsOn)).toBe("2026-11-23");
    expect(iso(sprints.at(-1)!.endsOn)).toBe("2026-11-24");
  });

  it.each([0, 1, 2, 3, 4, 5, 6])("anchor %i: every sprint starts on the anchor and is ≤ 7 days", (anchor) => {
    for (const startDay of ["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"]) {
      const term = { startsOn: d(startDay), endsOn: d(startDay) + 69 * DAY };
      const sprints = planSprints(term, anchor);
      expect(sprints.length).toBeGreaterThanOrEqual(9);
      expect(sprints[0]!.startsOn - term.startsOn).toBeLessThan(7 * DAY);
      expect(sprints[0]!.startsOn).toBeGreaterThanOrEqual(term.startsOn);
      for (const [i, s] of sprints.entries()) {
        expect(new Date(s.startsOn).getUTCDay()).toBe(anchor);
        expect(s.endsOn).toBeLessThanOrEqual(term.endsOn);
        if (i < sprints.length - 1) expect(s.endsOn - s.startsOn).toBe(6 * DAY);
        if (i > 0) expect(s.startsOn).toBe(sprints[i - 1]!.endsOn + DAY);
      }
      expect(sprints.at(-1)!.endsOn).toBe(term.endsOn);
    }
  });

  it("returns nothing when the term ends before its first anchor day", () => {
    expect(planSprints({ startsOn: d("2026-09-16"), endsOn: d("2026-09-18") }, 1)).toEqual([]);
  });
});

describe("sprintStatus", () => {
  const s = { startsOn: d("2026-10-07"), endsOn: d("2026-10-13"), closed: false };
  it.each([
    ["2026-10-06", "Upcoming"],
    ["2026-10-07", "Active"],
    ["2026-10-13", "Active"],
    ["2026-10-14", "Closed"],
  ])("%s → %s", (today, status) => {
    expect(sprintStatus(s, d(today))).toBe(status);
  });

  it("is Closed once closedAt is set, even mid-window", () => {
    expect(sprintStatus({ ...s, closed: true }, d("2026-10-08"))).toBe("Closed");
  });
});

describe("defaultBoardSprint", () => {
  const sprints = planSprints(FALL, null).map((p) => ({ ...p, closed: false }));

  it("picks the active sprint", () => {
    expect(defaultBoardSprint(sprints, d("2026-10-12"))!.number).toBe(4);
  });

  it("falls to the next upcoming sprint in a break", () => {
    expect(defaultBoardSprint(sprints, d("2026-09-01"))!.number).toBe(1);
  });

  it("falls to the latest sprint when all have ended", () => {
    expect(defaultBoardSprint(sprints, d("2026-12-10"))!.number).toBe(10);
  });

  it("is null with no sprints", () => {
    expect(defaultBoardSprint([], d("2026-10-12"))).toBeNull();
  });
});

describe("remapByOverlap", () => {
  const monday = planSprints(FALL, 1);

  it("moves to the rebuilt sprint overlapping the old window most", () => {
    // Old Wed 10-07..Tue 10-13 overlaps Mon 10-05..Sun 10-11 for 5 days, Mon 10-12.. for 2.
    const hit = remapByOverlap({ startsOn: d("2026-10-07"), endsOn: d("2026-10-13") }, monday);
    expect(iso(hit!.startsOn)).toBe("2026-10-05");
  });

  it("breaks a tie toward the earlier sprint", () => {
    const a = { startsOn: d("2026-10-01"), endsOn: d("2026-10-07") };
    const b = { startsOn: d("2026-10-08"), endsOn: d("2026-10-14") };
    expect(remapByOverlap({ startsOn: d("2026-10-05"), endsOn: d("2026-10-10") }, [b, a])).toBe(a);
  });

  it("with no overlap, takes the next sprint after the old window, else the last", () => {
    const a = { startsOn: d("2026-10-01"), endsOn: d("2026-10-07") };
    const b = { startsOn: d("2026-10-15"), endsOn: d("2026-10-21") };
    expect(remapByOverlap({ startsOn: d("2026-10-08"), endsOn: d("2026-10-14") }, [a, b])).toBe(b);
    expect(remapByOverlap({ startsOn: d("2026-11-01"), endsOn: d("2026-11-07") }, [a, b])).toBe(b);
    expect(remapByOverlap({ startsOn: d("2026-11-01"), endsOn: d("2026-11-07") }, [])).toBeNull();
  });
});

describe("isCarriedOnClose", () => {
  it.each([
    ["Todo", true],
    ["InProgress", true],
    ["InReview", true],
    ["Backlog", true],
    ["Done", false],
    ["Cancelled", false],
  ])("%s → %s", (status, carried) => {
    expect(isCarriedOnClose(status)).toBe(carried);
  });
});

describe("deriveEpicStatus", () => {
  it("Cancelled override wins", () => {
    expect(deriveEpicStatus({ cancelledAt: new Date() }, ["InProgress"])).toBe("Cancelled");
  });
  it.each([
    [[], "NotStarted"],
    [["Todo", "Todo"], "NotStarted"],
    [["Todo", "InProgress"], "InProgress"],
    [["Todo", "Done"], "InProgress"],
    [["InReview"], "InProgress"],
    [["Done", "Cancelled"], "Done"],
    [["Cancelled"], "Done"],
  ])("%j → %s", (statuses, status) => {
    expect(deriveEpicStatus({ cancelledAt: null }, statuses)).toBe(status);
  });
});

describe("epicSprintSpan", () => {
  it("spans first to last sprint holding a task", () => {
    const s1 = { startsOn: d("2026-09-16"), endsOn: d("2026-09-22") };
    const s3 = { startsOn: d("2026-09-30"), endsOn: d("2026-10-06") };
    expect(epicSprintSpan([s3, null, s1])).toEqual({ startsOn: s1.startsOn, endsOn: s3.endsOn });
  });
  it("is null when nothing is scheduled", () => {
    expect(epicSprintSpan([])).toBeNull();
    expect(epicSprintSpan([null, null])).toBeNull();
  });
});

describe("backfillPlacement", () => {
  const sprints: BackfillSprint[] = planSprints(FALL, 1).map((p) => ({
    id: `s${p.number}`,
    termId: "fall",
    startsOn: p.startsOn,
    endsOn: p.endsOn,
  }));
  const terms = [{ id: "fall", ...FALL }];
  const today = d("2026-10-12"); // Sprint 4 (Mon 10-12..Sun 10-18) is active
  const current = sprints.find((s) => s.id === "s4")!;
  const place = (day: string | null, open: boolean) =>
    backfillPlacement({ day: day ? d(day) : null, open }, sprints, terms, current, today);

  it.each<[string, string | null, boolean, string | null, boolean]>([
    ["undated → backlog", null, true, null, false],
    ["undated done → backlog", null, false, null, false],
    ["future-dated open → its sprint", "2026-10-30", true, "s6", false],
    ["active-sprint open → active sprint", "2026-10-14", true, "s4", false],
    ["past-sprint done → that sprint", "2026-09-23", false, "s1", false],
    ["past-sprint open → active sprint, carried", "2026-09-23", true, "s4", true],
    ["pre-anchor days done → Sprint 1", "2026-09-17", false, "s1", false],
    ["pre-anchor days open → active (Sprint 1 is past), carried", "2026-09-17", true, "s4", true],
    ["old-term done → backlog", "2026-05-01", false, null, false],
    ["old-term open → active sprint, carried", "2026-05-01", true, "s4", true],
    ["after every sprint, open → active, not carried", "2027-02-01", true, "s4", false],
  ])("%s", (_name, day, open, sprintId, carried) => {
    expect(place(day, open)).toEqual({ sprintId, carried });
  });

  it("open stale work goes to the backlog when no sprint is current", () => {
    expect(
      backfillPlacement({ day: d("2026-05-01"), open: true }, [], terms, null, today),
    ).toEqual({ sprintId: null, carried: false });
  });

  it("pre-anchor days of a future term go to that term's Sprint 1", () => {
    expect(place("2026-09-19", true)).toEqual({ sprintId: "s4", carried: true });
    const upcomingFall = backfillPlacement(
      { day: d("2026-09-19"), open: true },
      sprints,
      terms,
      null,
      d("2026-09-01"),
    );
    expect(upcomingFall).toEqual({ sprintId: "s1", carried: false });
  });
});
