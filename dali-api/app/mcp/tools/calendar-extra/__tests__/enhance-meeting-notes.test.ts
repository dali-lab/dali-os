import { describe, it, expect, vi } from "vitest";

vi.mock("~/calendar/lib/enhance-meeting-notes.server", () => ({ enhanceMeetingNotes: vi.fn() }));

import { enhanceMeetingNotes } from "~/calendar/lib/enhance-meeting-notes.server";
import {
  runEnhanceMeetingNotes,
  ENHANCE_MEETING_NOTES_DEF,
} from "../enhance-meeting-notes";

describe("enhance_meeting_notes", () => {
  it("requires mcp:write scope", () => {
    expect(ENHANCE_MEETING_NOTES_DEF.requiredScope).toBe("mcp:write");
  });

  it("hands the caller and request to the service and returns its result unchanged", async () => {
    const user = { id: "u1", daliEmail: "a@dali.edu", dartmouthEmail: null, netId: null, firstName: "Ada", lastName: "L" };
    const request = new Request("http://localhost/mcp");
    const result = { applied: true, enhancedAt: "2026-10-10T00:00:00.000Z", enhancedBy: "Ada L" };
    vi.mocked(enhanceMeetingNotes).mockResolvedValue(result as never);
    const out = await runEnhanceMeetingNotes({ user, scopes: ["mcp:write"], request } as never, {
      recordingId: "rec1",
      apply: true,
    });
    expect(out).toBe(result);
    expect(enhanceMeetingNotes).toHaveBeenCalledWith({ user, request }, { recordingId: "rec1", apply: true });
  });

  it("lets service errors through with their status", async () => {
    vi.mocked(enhanceMeetingNotes).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(
      runEnhanceMeetingNotes({ user: {}, scopes: [], request: new Request("http://x") } as never, { recordingId: "r" }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
