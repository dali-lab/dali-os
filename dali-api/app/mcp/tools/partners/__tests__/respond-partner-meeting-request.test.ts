import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});

vi.mock("~/partners/lib/partner-meetings.server", () => ({
  respondToMeetingRequest: vi.fn(),
}));

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const required = spec[action];
    if (!required) throw new McpInvalidError(`Unknown action '${action}'.`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { McpError, McpForbiddenError, McpInvalidError, requireForAction };
});

import { isCore } from "~/lib/roles";
import { respondToMeetingRequest } from "~/partners/lib/partner-meetings.server";
import {
  runRespondPartnerMeetingRequest,
  RESPOND_PARTNER_MEETING_REQUEST_TOOL,
} from "../respond-partner-meeting-request";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("respond_partner_meeting_request metadata", () => {
  it("requires mcp:write scope", () => {
    expect(RESPOND_PARTNER_MEETING_REQUEST_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runRespondPartnerMeetingRequest("u1", { requestId: "r1", action: "accept" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("rejects an unknown action", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runRespondPartnerMeetingRequest("u1", { requestId: "r1", action: "maybe" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("requires requestId", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runRespondPartnerMeetingRequest("u1", { action: "accept" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });
});

describe("accept", () => {
  it("returns ok with the new meeting id", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(respondToMeetingRequest).mockResolvedValue({ ok: true, scheduledMeetingId: "meet-1" });
    const out = await runRespondPartnerMeetingRequest("u1", { requestId: "r1", action: "accept" });
    expect(out).toEqual({ ok: true, scheduledMeetingId: "meet-1" });
    expect(respondToMeetingRequest).toHaveBeenCalledWith({
      requestId: "r1",
      actorUserId: "u1",
      action: "accept",
      note: null,
    });
  });

  it("surfaces a conflict", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(respondToMeetingRequest).mockResolvedValue({
      ok: true,
      conflict: true,
      busyUserIds: ["u2"],
      scheduledMeetingId: "meet-1",
    });
    const out = await runRespondPartnerMeetingRequest("u1", { requestId: "r1", action: "accept" });
    expect(out).toEqual({
      ok: true,
      conflict: true,
      busyUserIds: ["u2"],
      scheduledMeetingId: "meet-1",
    });
  });

  it("throws McpInvalidError when the helper fails", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(respondToMeetingRequest).mockResolvedValue({ ok: false, error: "Meeting request not found" });
    await expect(
      runRespondPartnerMeetingRequest("u1", { requestId: "r1", action: "accept" }),
    ).rejects.toMatchObject({ name: "McpInvalidError", message: "Meeting request not found" });
  });
});

describe("decline", () => {
  it("passes the trimmed note through", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(respondToMeetingRequest).mockResolvedValue({ ok: true });
    await runRespondPartnerMeetingRequest("u1", {
      requestId: "r1",
      action: "decline",
      note: "  Can't make it  ",
    });
    expect(respondToMeetingRequest).toHaveBeenCalledWith({
      requestId: "r1",
      actorUserId: "u1",
      action: "decline",
      note: "Can't make it",
    });
  });
});
