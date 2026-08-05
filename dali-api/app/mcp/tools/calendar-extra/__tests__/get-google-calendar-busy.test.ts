import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  return { McpError, McpNotFoundError, McpForbiddenError, McpInvalidError };
});
vi.mock("~/lib/db");
vi.mock("~/lib/google-calendar", () => ({
  fetchBusyEvents: vi.fn(),
}));

import { fetchBusyEvents } from "~/lib/google-calendar";
import {
  runGetGoogleCalendarBusy,
  GET_GOOGLE_CALENDAR_BUSY_DEF,
} from "~/mcp/tools/calendar-extra/get-google-calendar-busy";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("get_google_calendar_busy", () => {
  it("requires the mcp:read scope", () => {
    expect(GET_GOOGLE_CALENDAR_BUSY_DEF.requiredScope).toBe("mcp:read");
  });

  it("throws McpInvalidError when dates are invalid", async () => {
    await expect(
      runGetGoogleCalendarBusy("u1", {
        start: "not-a-date",
        end: "2026-08-10T17:00:00Z",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("wraps fetchBusyEvents errors as McpInvalidError", async () => {
    vi.mocked(fetchBusyEvents).mockRejectedValue(new Error("Token missing"));
    await expect(
      runGetGoogleCalendarBusy("u1", {
        start: "2026-08-10T09:00:00Z",
        end: "2026-08-10T17:00:00Z",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError", message: expect.stringContaining("Token missing") });
  });

  it("returns busy blocks from fetchBusyEvents", async () => {
    const mockBusy = [
      { start: "2026-08-10T10:00:00Z", end: "2026-08-10T11:00:00Z", title: "Focus time" },
    ];
    vi.mocked(fetchBusyEvents).mockResolvedValue(mockBusy as never);

    const out = await runGetGoogleCalendarBusy("u1", {
      start: "2026-08-10T09:00:00Z",
      end: "2026-08-10T17:00:00Z",
    });

    expect(out).toEqual({ busy: mockBusy });
    expect(fetchBusyEvents).toHaveBeenCalledWith(
      "u1",
      new Date("2026-08-10T09:00:00Z"),
      new Date("2026-08-10T17:00:00Z"),
    );
  });
});
