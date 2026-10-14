import { describe, it, expect } from "vitest";
import { audienceLine, type Audience } from "../page-audience";

const a = (over: Partial<Audience>): Audience => ({ kind: "private", label: "Only you", permission: "Edit", ...over });

describe("audienceLine", () => {
  it("adds the tier for group, lab and public audiences", () => {
    expect(audienceLine(a({ kind: "group", label: "Core", permission: "Edit" }))).toBe("Core · can edit");
    expect(audienceLine(a({ kind: "lab", label: "Everyone in the lab", permission: "Comment" }))).toBe(
      "Everyone in the lab · can comment",
    );
    expect(audienceLine(a({ kind: "public", label: "Anyone with the link", permission: "View" }))).toBe(
      "Anyone with the link · can view",
    );
  });

  it("uses the label alone for private, people and project audiences", () => {
    expect(audienceLine(a({ kind: "private", label: "Owner only" }))).toBe("Owner only");
    expect(audienceLine(a({ kind: "people", label: "Shared with 2 people and groups" }))).toBe(
      "Shared with 2 people and groups",
    );
    expect(audienceLine(a({ kind: "project", label: "Project team · lab can view" }))).toBe(
      "Project team · lab can view",
    );
  });

  it("appends the meeting attendees who can edit, to any kind of audience", () => {
    expect(audienceLine(a({ kind: "project", label: "Project team", meetingEditors: 6 }))).toBe(
      "Project team · 6 meeting attendees can edit",
    );
    expect(audienceLine(a({ kind: "group", label: "Core", permission: "Edit", meetingEditors: 2 }))).toBe(
      "Core · can edit · 2 meeting attendees can edit",
    );
  });

  it("says attendee in the singular", () => {
    expect(audienceLine(a({ meetingEditors: 1 }))).toBe("Only you · 1 meeting attendee can edit");
  });

  it("adds nothing for none", () => {
    expect(audienceLine(a({ meetingEditors: 0 }))).toBe("Only you");
  });
});
