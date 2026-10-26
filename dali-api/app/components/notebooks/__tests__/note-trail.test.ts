import { describe, expect, it } from "vitest";
import { noteTabLabel, noteTrail, tabWeekLabels } from "~/components/notebooks/note-trail";

const location = {
  scopeId: "projects",
  scopeLabel: "Projects",
  folderId: "f1",
  folders: [
    { id: "p1", title: "Project Alpha" },
    { id: "f1", title: "Meetings" },
  ],
  path: "Projects ▸ Project Alpha ▸ Meetings",
};

describe("noteTrail", () => {
  it("links the space, each folder and the notebook, and ends on the unlinked tab", () => {
    expect(noteTrail(location, { id: "nb1", title: "Weekly sync" }, "Oct 14, 2026")).toEqual([
      { label: "Projects", to: "/drive?scope=projects" },
      { label: "Project Alpha", to: "/drive?scope=projects&folder=p1" },
      { label: "Meetings", to: "/drive?scope=projects&folder=f1" },
      { label: "Weekly sync", to: "/documents/nb1" },
      { label: "Oct 14, 2026" },
    ]);
  });

  it("goes straight from the space to the notebook at a space's top level", () => {
    expect(noteTrail({ ...location, folderId: null, folders: [] }, { id: "nb1", title: "Notes" }, "Agenda")).toEqual([
      { label: "Projects", to: "/drive?scope=projects" },
      { label: "Notes", to: "/documents/nb1" },
      { label: "Agenda" },
    ]);
  });
});

describe("noteTabLabel", () => {
  const occurrence = new Date("2026-10-19T18:00:00Z");

  it("shows a renamed meeting note by its title, not its date", () => {
    expect(noteTabLabel({ title: "Project Lighthouse", meetingOccurrenceStart: occurrence })).toBe("Project Lighthouse");
  });

  it("keeps the date a new note was titled with", () => {
    expect(noteTabLabel({ title: "Oct 19, 2026", meetingOccurrenceStart: occurrence })).toBe("Oct 19, 2026");
  });

  it("falls back to the meeting date when the title is cleared", () => {
    expect(noteTabLabel({ title: "", meetingOccurrenceStart: occurrence })).toBe("Oct 19, 2026");
    expect(noteTabLabel({ title: "   ", meetingOccurrenceStart: occurrence })).toBe("Oct 19, 2026");
  });

  it("shows a plain document by its title", () => {
    expect(noteTabLabel({ title: "Alejandro, Leah <> Kiran", meetingOccurrenceStart: null })).toBe("Alejandro, Leah <> Kiran");
  });
});

describe("tabWeekLabels", () => {
  const ET = "America/New_York";
  const fall = { code: "26F", startDate: new Date("2026-09-14T00:00:00Z"), endDate: new Date("2026-11-24T00:00:00Z") };
  const winter = { code: "27W", startDate: new Date("2027-01-04T00:00:00Z"), endDate: new Date("2027-03-13T00:00:00Z") };
  const terms = [winter, fall];
  const at = (iso: string) => new Date(iso);

  it("counts weeks from the term's first day, which is in Week 1", () => {
    expect(tabWeekLabels([at("2026-09-14T14:00:00Z")], terms, ET)).toEqual(["Week 1"]);
  });

  it("runs each week for seven days from the start date, not Monday to Sunday", () => {
    const starts = [at("2026-09-20T14:00:00Z"), at("2026-09-21T14:00:00Z"), at("2026-10-23T14:00:00Z")];
    expect(tabWeekLabels(starts, terms, ET)).toEqual(["Week 1", "Week 2", "Week 6"]);
  });

  it("places a meeting by its day in the lab's zone, not in UTC", () => {
    // 9pm ET on Sunday Sep 20 is already Monday in UTC.
    expect(tabWeekLabels([at("2026-09-21T01:00:00Z")], terms, ET)).toEqual(["Week 1"]);
  });

  it("includes the term's last day", () => {
    expect(tabWeekLabels([at("2026-11-24T22:00:00Z")], terms, ET)).toEqual(["Week 11"]);
  });

  it("calls a meeting between terms Break", () => {
    expect(tabWeekLabels([at("2026-12-10T15:00:00Z"), at("2026-11-20T15:00:00Z")], terms, ET)).toEqual([
      "Break",
      "Week 10",
    ]);
  });

  it("leads with the term code once the notes cross terms", () => {
    expect(tabWeekLabels([at("2027-01-05T15:00:00Z"), at("2026-11-20T15:00:00Z")], terms, ET)).toEqual([
      "27W Week 1",
      "26F Week 10",
    ]);
  });

  it("gives undated tabs no week", () => {
    expect(tabWeekLabels([null, at("2026-09-14T14:00:00Z")], terms, ET)).toEqual([null, "Week 1"]);
  });

  it("calls everything Break when no term is known", () => {
    expect(tabWeekLabels([at("2026-09-14T14:00:00Z")], [], ET)).toEqual(["Break"]);
  });
});
