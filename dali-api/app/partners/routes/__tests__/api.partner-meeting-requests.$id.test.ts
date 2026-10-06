import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", async (orig) => {
  const real = await orig<typeof import("~/lib/auth")>();
  return { ...real, requireAuth: vi.fn() };
});
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/partners/lib/partner-meetings.server", () => ({
  respondToMeetingRequest: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { respondToMeetingRequest } from "~/partners/lib/partner-meetings.server";
import { action } from "~/partners/routes/api.partner-meeting-requests.$id";

function post(body: unknown) {
  const request = new Request("http://localhost/api/partner-meeting-requests/req-1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return action({ request, params: { id: "req-1" }, context: {} } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core-1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("POST /api/partner-meeting-requests/:id", () => {
  it("rejects a non-Core caller", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await post({ action: "accept" });
    expect(res.status).toBe(403);
  });

  it("validates the action enum", async () => {
    const res = await post({ action: "maybe" });
    expect(res.status).toBe(400);
  });

  it("returns 400 with the error when the helper fails", async () => {
    vi.mocked(respondToMeetingRequest).mockResolvedValue({ ok: false, error: "Meeting request not found" });
    const res = await post({ action: "accept" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Meeting request not found" });
  });

  it("accepts and surfaces a conflict", async () => {
    vi.mocked(respondToMeetingRequest).mockResolvedValue({
      ok: true,
      conflict: true,
      busyUserIds: ["u1"],
      scheduledMeetingId: "m1",
    });
    const res = await post({ action: "accept" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, conflict: true, busyUserIds: ["u1"] });
  });

  it("declines with a note", async () => {
    vi.mocked(respondToMeetingRequest).mockResolvedValue({ ok: true });
    const res = await post({ action: "decline", note: "Can't make it" });
    expect(res.status).toBe(200);
    expect(respondToMeetingRequest).toHaveBeenCalledWith({
      requestId: "req-1",
      actorUserId: "core-1",
      action: "decline",
      note: "Can't make it",
    });
  });
});
