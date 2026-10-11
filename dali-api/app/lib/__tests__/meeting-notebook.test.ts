import { describe, it, expect } from "vitest";
import { meetingNotebookIdentity, termForDate, type NotebookMeeting } from "~/lib/meeting-notebook";

const fall = { id: "t-26f", code: "26F", startDate: new Date("2026-09-14T00:00:00Z") };
const summer = { id: "t-26x", code: "26X", startDate: new Date("2026-06-22T00:00:00Z") };
const windows = [fall, summer];

const meeting = (over: Partial<NotebookMeeting> = {}): NotebookMeeting => ({
  title: "Sync",
  meetingType: "Other",
  meetingTypeLabel: "Design sync",
  projectId: null,
  isCoreMeeting: false,
  scopeType: "UserList",
  scopeId: null,
  organizerId: "u1",
  participantUserIds: ["u2", "u3"],
  guestEmails: [],
  ...over,
});

describe("termForDate", () => {
  it("picks the term a date falls in", () => {
    expect(termForDate(windows, new Date("2026-10-06T00:00:00Z"))).toBe(fall);
    expect(termForDate(windows, new Date("2026-07-01T00:00:00Z"))).toBe(summer);
  });

  it("files a date in a break under the term before it", () => {
    expect(termForDate(windows, new Date("2026-09-01T00:00:00Z"))).toBe(summer);
  });

  it("files a date before every term under the oldest", () => {
    expect(termForDate(windows, new Date("2025-01-01T00:00:00Z"))).toBe(summer);
  });

  it("has no term when none exist", () => {
    expect(termForDate([], new Date())).toBeNull();
  });
});

describe("meetingNotebookIdentity", () => {
  it("gives a project's team meetings one notebook per term, named for the term", () => {
    const team = meeting({ meetingType: "Team", meetingTypeLabel: null, projectId: "p1" });
    const a = meetingNotebookIdentity(team, fall);
    // A different meeting with different people, same project and term.
    const b = meetingNotebookIdentity({ ...team, organizerId: "u9", participantUserIds: [] }, fall);
    expect(a.title).toBe("Team meeting note 26F");
    expect(b.key).toBe(a.key);
    expect(meetingNotebookIdentity(team, summer).key).not.toBe(a.key);
  });

  it("keeps a project's partner notes apart from its team notes", () => {
    const team = meeting({ meetingType: "Team", projectId: "p1" });
    const partner = meetingNotebookIdentity({ ...team, meetingType: "Partner" }, fall);
    expect(partner.title).toBe("Partner meeting note 26F");
    expect(partner.key).not.toBe(meetingNotebookIdentity(team, fall).key);
  });

  it("puts meetings with the same people in one notebook, whatever the term or order", () => {
    const a = meetingNotebookIdentity(meeting(), fall);
    const b = meetingNotebookIdentity(
      meeting({ title: "Catch up", organizerId: "u3", participantUserIds: ["u1", "u2", "u1"] }),
      summer,
    );
    expect(b.key).toBe(a.key);
    expect(meetingNotebookIdentity(meeting({ participantUserIds: ["u2"] }), fall).key).not.toBe(a.key);
  });

  it("keys a group meeting on the group, not on who is in it today", () => {
    const group = meeting({ scopeType: "Group", scopeId: "g1" });
    expect(meetingNotebookIdentity({ ...group, participantUserIds: ["u7"] }, fall).key).toBe(
      meetingNotebookIdentity(group, fall).key,
    );
  });

  it("keeps Core, project and general notes for the same people apart", () => {
    const keys = [
      meetingNotebookIdentity(meeting(), fall).key,
      meetingNotebookIdentity(meeting({ isCoreMeeting: true }), fall).key,
      meetingNotebookIdentity(meeting({ projectId: "p1" }), fall).key,
    ];
    expect(new Set(keys).size).toBe(3);
  });

  it("names an audience notebook for the meeting without doubling 'meeting'", () => {
    expect(meetingNotebookIdentity(meeting(), fall).title).toBe("Design sync meeting notes");
    expect(meetingNotebookIdentity(meeting({ meetingTypeLabel: "Core meeting" }), fall).title).toBe(
      "Core meeting notes",
    );
    expect(meetingNotebookIdentity(meeting({ meetingTypeLabel: null }), fall).title).toBe(
      "Sync meeting notes",
    );
  });
});
