import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/scheduled-meeting", () => ({
  cancelScheduledMeeting: vi.fn(),
}));

import { cancelScheduledMeeting } from "~/lib/scheduled-meeting";
import {
  runCancelMeeting,
  CANCEL_MEETING_TOOL,
  CancelMeetingError,
} from "~/mcp/tools/cancel-meeting";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cancel_meeting", () => {
  it("requires the mcp:write scope", () => {
    expect(CANCEL_MEETING_TOOL.requiredScope).toBe("mcp:write");
  });

  it("returns alreadyCancelled flag on success", async () => {
    vi.mocked(cancelScheduledMeeting).mockResolvedValue({ ok: true, alreadyCancelled: false });
    const out = await runCancelMeeting("u1", { meetingId: "m1" });
    expect(out).toEqual({ ok: true, alreadyCancelled: false });
    expect(cancelScheduledMeeting).toHaveBeenCalledWith("m1", "u1");
  });

  it("propagates 403 when caller is not the organizer", async () => {
    vi.mocked(cancelScheduledMeeting).mockResolvedValue({
      ok: false,
      error: "Only the organizer can cancel",
      status: 403,
    });
    await expect(
      runCancelMeeting("u1", { meetingId: "m1" }),
    ).rejects.toMatchObject({ name: "CancelMeetingError", status: 403 });
  });

  it("propagates 404 when meeting is missing", async () => {
    vi.mocked(cancelScheduledMeeting).mockResolvedValue({
      ok: false,
      error: "Not found",
      status: 404,
    });
    await expect(
      runCancelMeeting("u1", { meetingId: "nope" }),
    ).rejects.toBeInstanceOf(CancelMeetingError);
  });
});
