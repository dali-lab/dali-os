import { describe, it, expect } from "vitest";
import {
  buildTrackerPeople,
  defaultReminderMessage,
  dismissedNote,
  remindLabel,
  remindablePeople,
  reminderBlock,
  reminderBlockMessage,
  trackerCounts,
  trackerSubtitle,
} from "~/forms/lib/form-tracker";

const none = new Set<string>();
const byId = (people: ReturnType<typeof buildTrackerPeople>) =>
  Object.fromEntries(people.map((p) => [p.userId, p]));

describe("buildTrackerPeople", () => {
  it("unions group members and to-do recipients, deduped, keeping every source", () => {
    const people = buildTrackerPeople({
      groups: [
        { name: "Core", memberIds: ["ada", "bo"] },
        { name: "Interns", memberIds: ["bo", "cy"] },
      ],
      todos: [
        { userId: "bo", readAt: null },
        { userId: "di", readAt: null },
      ],
      respondedIds: none,
    });
    const p = byId(people);
    expect(people).toHaveLength(4);
    expect(p.ada.sources).toEqual(["Core"]);
    expect(p.bo.sources).toEqual(["Core", "Interns", "Announcement"]);
    expect(p.di.sources).toEqual(["Announcement"]);
  });

  it("lists a source once when a person has several to-dos", () => {
    const [only] = buildTrackerPeople({
      groups: [],
      todos: [
        { userId: "ada", readAt: null },
        { userId: "ada", readAt: new Date() },
      ],
      respondedIds: none,
    });
    expect(only.sources).toEqual(["Announcement"]);
  });

  it("marks responders, and does not count someone outside the list", () => {
    const people = buildTrackerPeople({
      groups: [{ name: "Core", memberIds: ["ada", "bo"] }],
      todos: [],
      respondedIds: new Set(["ada", "stranger"]),
    });
    expect(byId(people).ada.responded).toBe(true);
    expect(byId(people).bo.responded).toBe(false);
    expect(people.map((p) => p.userId)).not.toContain("stranger");
  });

  it("treats a person as dismissed only when every to-do is read and they have not responded", () => {
    const read = new Date();
    const people = buildTrackerPeople({
      groups: [{ name: "Core", memberIds: ["ada", "bo", "cy", "di"] }],
      todos: [
        { userId: "ada", readAt: read },
        { userId: "bo", readAt: read },
        { userId: "bo", readAt: null },
        { userId: "cy", readAt: read },
      ],
      respondedIds: new Set(["cy"]),
    });
    const p = byId(people);
    expect(p.ada.dismissed).toBe(true);
    expect(p.bo.dismissed).toBe(false);
    expect(p.cy.dismissed).toBe(false);
    expect(p.di.dismissed).toBe(false);
  });
});

describe("buildTrackerPeople banner viewers", () => {
  it("adds the Banner source and counts viewers as expected, once alongside other sources", () => {
    const people = buildTrackerPeople({
      groups: [{ name: "Core", memberIds: ["ada"] }],
      todos: [{ userId: "bo", readAt: null }],
      bannerViewerIds: ["ada", "bo", "cy"],
      respondedIds: none,
    });
    const p = byId(people);
    expect(people).toHaveLength(3);
    expect(p.ada.sources).toEqual(["Core", "Banner"]);
    expect(p.bo.sources).toEqual(["Announcement", "Banner"]);
    expect(p.cy.sources).toEqual(["Banner"]);
  });

  it("leaves a banner-only viewer remindable and never dismissed", () => {
    const [only] = buildTrackerPeople({ groups: [], todos: [], bannerViewerIds: ["cy"], respondedIds: none });
    expect(only.dismissed).toBe(false);
    expect(remindablePeople([only])).toHaveLength(1);
  });

  it("keeps a dismissed to-do dismissed even when the banner also reached them", () => {
    const [p] = buildTrackerPeople({
      groups: [],
      todos: [{ userId: "ada", readAt: new Date() }],
      bannerViewerIds: ["ada"],
      respondedIds: none,
    });
    expect(p.dismissed).toBe(true);
  });

  it("marks a banner viewer who responded", () => {
    const [p] = buildTrackerPeople({ groups: [], todos: [], bannerViewerIds: ["ada"], respondedIds: new Set(["ada"]) });
    expect(p.responded).toBe(true);
  });
});

describe("trackerCounts", () => {
  it("is null when nobody is expected", () => {
    expect(trackerCounts([])).toBeNull();
  });

  it("counts expected and responded", () => {
    const people = buildTrackerPeople({
      groups: [{ name: "Core", memberIds: ["a", "b", "c"] }],
      todos: [],
      respondedIds: new Set(["a", "b"]),
    });
    expect(trackerCounts(people)).toEqual({ expected: 3, responded: 2 });
  });
});

describe("remindablePeople", () => {
  it("leaves out responders and dismissed people", () => {
    const people = [
      { userId: "a", sources: [], responded: true, dismissed: false },
      { userId: "b", sources: [], responded: false, dismissed: true },
      { userId: "c", sources: [], responded: false, dismissed: false },
    ];
    expect(remindablePeople(people).map((p) => p.userId)).toEqual(["c"]);
  });
});

describe("copy", () => {
  it("handles one person", () => {
    expect(remindLabel(1)).toBe("Remind 1 person");
    expect(remindLabel(11)).toBe("Remind 11 people");
    expect(trackerSubtitle(1, 1, null)).toBe("1 of 1 person.");
  });

  it("builds the subtitle with and without a close date", () => {
    const closes = new Date("2026-11-08T17:00:00Z");
    expect(trackerSubtitle(13, 71, closes, "America/New_York")).toBe("13 of 71 people. Closes Nov 8.");
    expect(trackerSubtitle(13, 71, null)).toBe("13 of 71 people.");
  });

  it("prefills the reminder, dropping the close sentence without a date", () => {
    const closes = new Date("2026-11-08T17:00:00Z");
    expect(defaultReminderMessage("Intake", closes, "America/New_York")).toBe(
      "You haven't filled out Intake yet. It closes Nov 8.",
    );
    expect(defaultReminderMessage("Intake", null)).toBe("You haven't filled out Intake yet.");
  });

  it("notes dismissals only when there are some", () => {
    expect(dismissedNote(0)).toBeNull();
    expect(dismissedNote(2)).toBe("2 dismissed the to-do and won't be reminded.");
  });
});

describe("reminderBlock", () => {
  const now = new Date(2026, 10, 2, 16, 0);
  const base = { published: true, lastRemindedAt: null, remindable: 5, now };

  it("allows a reminder with nothing in the way", () => {
    expect(reminderBlock(base)).toBeNull();
  });

  it("blocks an unpublished form before anything else", () => {
    expect(reminderBlock({ ...base, published: false, lastRemindedAt: now, remindable: 0 })).toBe("unpublished");
  });

  it("blocks inside 24 hours and frees at exactly 24", () => {
    const sent = new Date(2026, 10, 2, 15, 12);
    expect(reminderBlock({ ...base, lastRemindedAt: sent })).toBe("cooldown");
    expect(reminderBlock({ ...base, lastRemindedAt: new Date(now.getTime() - 24 * 3600_000) })).toBeNull();
  });

  it("blocks when only dismissed people are left", () => {
    expect(reminderBlock({ ...base, remindable: 0 })).toBe("dismissed-only");
  });

  it("explains each block", () => {
    expect(reminderBlockMessage("unpublished", null, now)).toBe(
      "This form isn't published, so a reminder would link to nothing.",
    );
    expect(reminderBlockMessage("dismissed-only", null, now)).toBe(
      "Everyone left dismissed the to-do, so there's nobody to remind.",
    );
    expect(reminderBlockMessage("cooldown", new Date(2026, 10, 2, 15, 12), now)).toBe(
      "Last reminder today at 3:12 PM. You can send another tomorrow.",
    );
    expect(reminderBlockMessage("cooldown", new Date(2026, 10, 1, 21, 5), now)).toBe(
      "Last reminder yesterday at 9:05 PM. You can send another today after 9:05 PM.",
    );
  });
});
