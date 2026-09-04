import { describe, it, expect } from "vitest";
import {
  emptyMeetingNote,
  meetingNoteValid,
  meetingNotePayload,
  type MeetingNoteState,
} from "~/calendar/components/meeting-note";

const base = (over: Partial<MeetingNoteState> = {}): MeetingNoteState => ({
  ...emptyMeetingNote,
  ...over,
});

describe("meetingNoteValid", () => {
  it("is valid when the note is disabled, regardless of other fields", () => {
    expect(meetingNoteValid(base({ enabled: false, about: "", label: "" }))).toBe(true);
  });

  it("requires a name for a General (no-project) note", () => {
    expect(meetingNoteValid(base({ enabled: true, about: "", label: "" }))).toBe(false);
    expect(meetingNoteValid(base({ enabled: true, about: "", label: "  " }))).toBe(false);
    expect(meetingNoteValid(base({ enabled: true, about: "", label: "All-hands" }))).toBe(true);
  });

  it("is always valid on the project path (no name needed)", () => {
    expect(meetingNoteValid(base({ enabled: true, about: "proj_1", label: "" }))).toBe(true);
  });
});

describe("meetingNotePayload", () => {
  it("emits nothing when the note is disabled", () => {
    expect(meetingNotePayload(base({ enabled: false, about: "proj_1" }))).toEqual({});
  });

  it("project path → Team/Partner + projectId, no label/location", () => {
    expect(meetingNotePayload(base({ enabled: true, about: "proj_1", subtype: "Team" }))).toEqual({
      meetingType: "Team",
      projectId: "proj_1",
    });
    expect(
      meetingNotePayload(base({ enabled: true, about: "proj_9", subtype: "Partner" })),
    ).toEqual({ meetingType: "Partner", projectId: "proj_9" });
  });

  it("General path → Other + trimmed label, no projectId", () => {
    expect(meetingNotePayload(base({ enabled: true, about: "", label: "  Sync  " }))).toEqual({
      meetingType: "Other",
      meetingTypeLabel: "Sync",
    });
  });

  it("omits noteLocation for the Lab-wide default (null or Lab top level)", () => {
    expect(
      meetingNotePayload(base({ enabled: true, about: "", label: "Sync", location: null })),
    ).not.toHaveProperty("noteLocation");
    expect(
      meetingNotePayload(
        base({
          enabled: true,
          about: "",
          label: "Sync",
          location: { workspaceType: "Lab", workspaceId: null, parentPageId: null, label: "Lab-wide" },
        }),
      ),
    ).not.toHaveProperty("noteLocation");
  });

  it("sends noteLocation for a chosen Lab folder", () => {
    const out = meetingNotePayload(
      base({
        enabled: true,
        about: "",
        label: "Sync",
        location: { workspaceType: "Lab", workspaceId: null, parentPageId: "folder_1", label: "Lab-wide / Meetings" },
      }),
    );
    expect(out.noteLocation).toEqual({ workspaceType: "Lab", workspaceId: null, parentPageId: "folder_1" });
  });

  it("sends noteLocation for a project destination", () => {
    const out = meetingNotePayload(
      base({
        enabled: true,
        about: "",
        label: "Sync",
        location: { workspaceType: "Project", workspaceId: "proj_2", parentPageId: null, label: "Fireflies" },
      }),
    );
    expect(out.noteLocation).toEqual({ workspaceType: "Project", workspaceId: "proj_2", parentPageId: null });
    // General notes never carry a projectId — filing location is not project association.
    expect(out).not.toHaveProperty("projectId");
  });
});
