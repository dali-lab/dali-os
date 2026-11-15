import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/calendar/lib/scheduled-meeting.server", () => ({ createScheduledMeeting: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), canViewForms: vi.fn(), isLabMember: vi.fn() }));
vi.mock("~/lib/groups.server", () => ({ isCoreGroup: vi.fn() }));
vi.mock("~/rooms/lib/rooms.server", () => ({ assertMeetingRoomsFree: vi.fn() }));

import { createScheduledMeeting } from "~/calendar/lib/scheduled-meeting.server";
import { isLabMember } from "~/lib/roles";
import { assertMeetingRoomsFree } from "~/rooms/lib/rooms.server";
import { runScheduleMeeting, ScheduleMeetingError, SCHEDULE_MEETING_TOOL } from "~/mcp/tools/schedule-meeting";

const user = { id: "u1", daliEmail: "u1@dali.dartmouth.edu", dartmouthEmail: null };
const base = { title: "Sync", durationMinutes: 30, participantUserIds: ["u2"] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createScheduledMeeting).mockResolvedValue({
    ok: true,
    meeting: { id: "m1", title: "Sync", status: "Searching", selectedAt: null, durationMinutes: 30, participantUserIds: ["u2"], externalEventId: null, meetingUrl: null },
    notePageId: "n1",
    notifiedCount: 1,
    gcalError: null,
  } as never);
});

const created = () => vi.mocked(createScheduledMeeting).mock.calls[0]![0];

describe("schedule_meeting notebook input", () => {
  it("advertises notebook and no noteLocation", () => {
    const props = SCHEDULE_MEETING_TOOL.inputSchema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("notebook");
    expect(props).not.toHaveProperty("noteLocation");
  });

  it("forwards an existing notebook", async () => {
    await runScheduleMeeting(user, { ...base, notebook: { existingId: "nb1" } });
    expect(created().notebook).toEqual({ existingId: "nb1" });
  });

  it("forwards a new notebook with its template", async () => {
    await runScheduleMeeting(user, { ...base, notebook: { title: "Retro", templatePageId: "t1" } });
    expect(created().notebook).toEqual({ title: "Retro", templatePageId: "t1" });
  });

  it("forwards no notebook when none is given", async () => {
    await runScheduleMeeting(user, base);
    expect(created().notebook).toBeUndefined();
  });

  it("ignores a noteLocation", async () => {
    await runScheduleMeeting(user, {
      ...base,
      noteLocation: { workspaceType: "Lab", workspaceId: null, parentPageId: "f1" },
    } as never);
    expect(created()).not.toHaveProperty("noteLocation");
  });

  it("refuses a notebook carrying a location, before creating anything", async () => {
    await expect(
      runScheduleMeeting(user, {
        ...base,
        notebook: { existingId: "nb1", location: { workspaceType: "Lab", workspaceId: null, parentPageId: null } },
      } as never),
    ).rejects.toBeInstanceOf(ScheduleMeetingError);
    expect(createScheduledMeeting).not.toHaveBeenCalled();
  });
});

describe("schedule_meeting guestEmails", () => {
  it("passes guestEmails through to createScheduledMeeting", async () => {
    await runScheduleMeeting(user, { ...base, scopeType: "UserList", guestEmails: ["partner@acme.com"] });
    expect(created().guestEmails).toEqual(["partner@acme.com"]);
  });

  it("omits guestEmails when not given", async () => {
    await runScheduleMeeting(user, { ...base, scopeType: "UserList" });
    expect(created().guestEmails).toBeUndefined();
  });

  it("requires an organizer email on file", async () => {
    await expect(
      runScheduleMeeting(
        { id: "u3", daliEmail: null, dartmouthEmail: null },
        { title: "x", durationMinutes: 30, scopeType: "None" },
      ),
    ).rejects.toBeInstanceOf(ScheduleMeetingError);
  });
});

describe("schedule_meeting roomIds", () => {
  const startTime = "2026-11-03T14:00:00-05:00";

  beforeEach(() => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    vi.mocked(assertMeetingRoomsFree).mockResolvedValue({ ok: true, value: null });
  });

  it("checks every occurrence, then claims each room once", async () => {
    await runScheduleMeeting(user, {
      ...base,
      startTime,
      recurrenceRule: "FREQ=WEEKLY;COUNT=4",
      roomIds: ["r1", "r2", "r1"],
    });
    expect(assertMeetingRoomsFree).toHaveBeenCalledWith({
      roomIds: ["r1", "r2"],
      selectedAt: new Date(startTime),
      durationMinutes: 30,
      recurrenceRule: "FREQ=WEEKLY;COUNT=4",
    });
    expect(created().roomIds).toEqual(["r1", "r2"]);
  });

  it("doesn't create the meeting when a room is taken", async () => {
    vi.mocked(assertMeetingRoomsFree).mockResolvedValue({ ok: false, error: "Pod is already booked then", status: 409 });
    await expect(runScheduleMeeting(user, { ...base, startTime, roomIds: ["r1"] })).rejects.toThrow(
      "Pod is already booked then",
    );
    expect(createScheduledMeeting).not.toHaveBeenCalled();
  });

  it("refuses rooms on a meeting with no time, which wouldn't hold them", async () => {
    await expect(runScheduleMeeting(user, { ...base, roomIds: ["r1"] })).rejects.toBeInstanceOf(ScheduleMeetingError);
    expect(createScheduledMeeting).not.toHaveBeenCalled();
  });

  it("refuses an unparseable start time", async () => {
    await expect(runScheduleMeeting(user, { ...base, startTime: "soon", roomIds: ["r1"] })).rejects.toBeInstanceOf(
      ScheduleMeetingError,
    );
    expect(assertMeetingRoomsFree).not.toHaveBeenCalled();
  });

  it("refuses a non-member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    await expect(runScheduleMeeting(user, { ...base, startTime, roomIds: ["r1"] })).rejects.toBeInstanceOf(
      ScheduleMeetingError,
    );
    expect(createScheduledMeeting).not.toHaveBeenCalled();
  });

  it("skips the room checks when no rooms are passed", async () => {
    await runScheduleMeeting(user, { ...base, startTime });
    expect(isLabMember).not.toHaveBeenCalled();
    expect(assertMeetingRoomsFree).not.toHaveBeenCalled();
    expect(created().roomIds).toEqual([]);
  });
});
