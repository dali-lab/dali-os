import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", async (orig) => {
  const real = await orig<typeof import("~/lib/auth")>();
  return { ...real, requireAuth: vi.fn() };
});
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/partners/lib/partner-meetings.server", () => ({
  linkScheduledMeetingToApplication: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { linkScheduledMeetingToApplication } from "~/partners/lib/partner-meetings.server";
import { action } from "~/partners/routes/api.partner-applications.$id.meetings.link";

function post(body: unknown) {
  const request = new Request("http://localhost/api/partner-applications/app-1/meetings/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return action({ request, params: { id: "app-1" }, context: {} } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core-1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("POST /api/partner-applications/:id/meetings/link", () => {
  it("rejects a non-Core caller", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await post({ scheduledMeetingId: "m1" });
    expect(res.status).toBe(403);
    expect(linkScheduledMeetingToApplication).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const res = await post({ scheduledMeetingId: "m1" });
    expect(res.status).toBe(401);
  });

  it("validates the body", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("404s when the application or meeting isn't found", async () => {
    vi.mocked(linkScheduledMeetingToApplication).mockResolvedValue(null);
    const res = await post({ scheduledMeetingId: "m1" });
    expect(res.status).toBe(404);
  });

  it("links the meeting and returns ok", async () => {
    vi.mocked(linkScheduledMeetingToApplication).mockResolvedValue({ id: "pm-1", scheduledAt: new Date() });
    const res = await post({ scheduledMeetingId: "m1" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
    expect(linkScheduledMeetingToApplication).toHaveBeenCalledWith({
      applicationId: "app-1",
      scheduledMeetingId: "m1",
      actorUserId: "core-1",
    });
  });
});
