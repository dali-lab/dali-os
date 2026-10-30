import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })),
}));
vi.mock("~/lib/db.server");
vi.mock("~/lib/notify-stream.server", () => ({ publishNotificationChange: vi.fn() }));
vi.mock("~/lib/google-calendar", () => ({ updateGoogleAttendeeRsvp: vi.fn() }));
vi.mock("~/calendar/lib/external-cache.server", () => ({ markCalendarChanged: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { updateGoogleAttendeeRsvp } from "~/lib/google-calendar";
import { markCalendarChanged } from "~/calendar/lib/external-cache.server";
import { action } from "~/routes/api.notifications.$id.rsvp";

const USER_ID = "user-1";
const db = prisma as any;
const order: string[] = [];

const request = (response = "accepted") =>
  new Request("http://localhost/api/notifications/n1/rsvp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ response }),
  });
const run = () => action({ request: request(), params: { id: "n1" } } as any);

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "user" },
  } as any);
  db.notification = {
    findUnique: vi.fn().mockResolvedValue({
      id: "n1",
      recipientUserId: USER_ID,
      scheduledMeetingId: "m1",
      scheduledMeeting: { externalEventId: "g1", organizerCalendarLinkId: "l1" },
    }),
    update: vi.fn().mockImplementation(async () => void order.push("db")),
  };
  db.user = { findUnique: vi.fn().mockResolvedValue({ daliEmail: "u@dali.dartmouth.edu", dartmouthEmail: null }) };
  vi.mocked(updateGoogleAttendeeRsvp).mockImplementation(async () => void order.push("google"));
  vi.mocked(markCalendarChanged).mockImplementation(async () => void order.push("marker"));
});

describe("POST /api/notifications/:id/rsvp", () => {
  it("saves the answer before it calls Google, then drops cached Google reads", async () => {
    const res = await run();
    expect(order).toEqual(["db", "google", "marker"]);
    expect(await res.json()).toEqual({ ok: true, gcalError: null });
  });

  it("keeps the saved answer and reports the failure when Google refuses", async () => {
    vi.mocked(updateGoogleAttendeeRsvp).mockRejectedValue(new Error("quota"));
    const res = await run();
    expect(db.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rsvp: "Accepted" }) }),
    );
    expect(await res.json()).toEqual({ ok: true, gcalError: "quota" });
  });

  it("only saves the answer for a meeting that was never pushed to Google", async () => {
    db.notification.findUnique.mockResolvedValue({
      id: "n1",
      recipientUserId: USER_ID,
      scheduledMeetingId: "m1",
      scheduledMeeting: { externalEventId: null, organizerCalendarLinkId: null },
    });
    const res = await run();
    expect(updateGoogleAttendeeRsvp).not.toHaveBeenCalled();
    expect(markCalendarChanged).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, gcalError: null });
  });

  it("refuses someone else's notification", async () => {
    db.notification.findUnique.mockResolvedValue({ id: "n1", recipientUserId: "other", scheduledMeetingId: "m1" });
    const res = await run();
    expect(res.status).toBe(403);
    expect(db.notification.update).not.toHaveBeenCalled();
  });
});
