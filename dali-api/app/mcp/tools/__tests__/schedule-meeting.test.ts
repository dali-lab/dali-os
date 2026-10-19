import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/scheduled-meeting", () => ({ createScheduledMeeting: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), canViewForms: vi.fn() }));
vi.mock("~/lib/groups", () => ({ isCoreGroup: vi.fn() }));

import { createScheduledMeeting } from "~/lib/scheduled-meeting";
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
