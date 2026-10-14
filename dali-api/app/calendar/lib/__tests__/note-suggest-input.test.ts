import { describe, expect, it } from "vitest";
import { suggestInputOfMeeting } from "~/calendar/lib/note-suggest-input";
import type { EditContext } from "~/calendar/components/EditMeetingModal";

const atlas = { id: "g-atlas", name: "Atlas", memberIds: ["a", "b"], projectId: "p1", systemKey: null };

const ctx = (meeting: Partial<EditContext["meeting"]>, mentorPairs?: { menteeId: string; menteeName: string }[]): EditContext => ({
  viewer: { userId: "me", timezone: "America/New_York", workingHours: [], workingHoursEnabled: false },
  meeting: {
    id: "m1",
    title: "Sync",
    startTime: null,
    durationMinutes: 30,
    recurrenceRule: null,
    location: null,
    roomIds: [],
    description: null,
    scopeType: "UserList",
    groupId: null,
    participantUserIds: ["a"],
    guestEmails: [],
    googleSynced: false,
    organizerId: "me",
    upcoming: true,
    ...meeting,
  },
  options: { users: [], groups: [atlas], ...(mentorPairs ? { mentorPairs } : {}) },
});

describe("suggestInputOfMeeting", () => {
  it("reads a people-list meeting as attendees with no group", () => {
    expect(suggestInputOfMeeting(ctx({}))).toEqual({
      attendeeIds: ["a"],
      groups: [atlas],
      invitedGroups: [],
      scopeGroupId: null,
      viewerId: "me",
      mentorPairs: [],
    });
  });

  it("reads a group meeting as that group, so its history can seed the default", () => {
    const out = suggestInputOfMeeting(ctx({ scopeType: "Group", groupId: "g-atlas", participantUserIds: ["a", "b"] }));
    expect(out).toMatchObject({ invitedGroups: [atlas], scopeGroupId: "g-atlas" });
  });

  it("drops the scope group once someone outside it is invited too", () => {
    const out = suggestInputOfMeeting(ctx({ scopeType: "Group", groupId: "g-atlas", participantUserIds: ["a", "b", "z"] }));
    expect(out).toMatchObject({ invitedGroups: [atlas], scopeGroupId: null });
  });

  it("ignores a group that is no longer listed", () => {
    expect(suggestInputOfMeeting(ctx({ scopeType: "Group", groupId: "gone" }))).toMatchObject({ invitedGroups: [], scopeGroupId: null });
  });

  it("carries the viewer's mentees", () => {
    const pairs = [{ menteeId: "a", menteeName: "Ann Lee" }];
    expect(suggestInputOfMeeting(ctx({}, pairs)).mentorPairs).toEqual(pairs);
  });
});
