import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/members/lib/community-events.server", () => ({ getEventForCalendar: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { getEventForCalendar } from "~/members/lib/community-events.server";
import { loader } from "../connect.events.$id.calendar";

const call = () =>
  loader({ request: new Request("http://localhost/connect/events/ev1/calendar.ics"), params: { id: "ev1" }, context: {} } as never);

const event = (over: Record<string, unknown> = {}) => ({
  id: "ev1",
  title: "Alumni Mixer!",
  description: "Bring a friend",
  startsAt: new Date("2026-12-01T23:00:00Z"),
  endsAt: new Date("2026-12-02T00:00:00Z"),
  online: false,
  meetingUrl: null,
  placeName: "Cafe Nero",
  address: "1 Main St",
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
});

describe("calendar.ics route", () => {
  it("redirects visitors who are not signed in", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    const res = (await call()) as Response;
    expect(res.status).toBe(302);
    expect(getEventForCalendar).not.toHaveBeenCalled();
  });

  it("serves the event as a calendar file", async () => {
    vi.mocked(getEventForCalendar).mockResolvedValue({ ok: true, id: "ev1", event: event() });
    const res = (await call()) as Response;
    expect(getEventForCalendar).toHaveBeenCalledWith("u1", "ev1");
    expect(res.headers.get("Content-Type")).toContain("text/calendar");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="alumni-mixer.ics"');
    const body = await res.text();
    expect(body).toContain("SUMMARY:Alumni Mixer!");
    expect(body).toContain("DTSTART:20261201T230000Z");
    expect(body).toContain("LOCATION:Cafe Nero\\, 1 Main St");
  });

  it("uses the join link for online events", async () => {
    vi.mocked(getEventForCalendar).mockResolvedValue({
      ok: true,
      id: "ev1",
      event: event({ online: true, meetingUrl: "https://meet.example.edu/x", placeName: null, address: null }),
    });
    const body = await ((await call()) as Response).text();
    expect(body).toContain("URL:https://meet.example.edu/x");
    expect(body).not.toContain("LOCATION");
  });

  it("passes the access error through", async () => {
    vi.mocked(getEventForCalendar).mockResolvedValue({ ok: false, status: 403, error: "This event is for alumni." });
    const res = (await call()) as Response;
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("This event is for alumni.");
  });
});
