// Regression for the RSVP crash: a rejected Google write used to escape
// handleEventAction's try/catch (an unawaited `return handleEventRsvp(...)`),
// which blanked the whole calendar page into the root error boundary instead
// of surfacing a normal action error.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/google-calendar", () => ({
  fetchCalendarEvents: vi.fn(),
  createGoogleCalendarEvent: vi.fn(),
  patchGoogleCalendarEvent: vi.fn(),
  deleteGoogleCalendarEvent: vi.fn(),
  getGoogleEvent: vi.fn(),
  createCalendar: vi.fn(),
  patchCalendar: vi.fn(),
  deleteCalendar: vi.fn(),
  getValidAccessTokenForLink: vi.fn(),
  listCalendarsForLink: vi.fn(),
  subscribeCalendarForLink: vi.fn(),
  respondToGoogleEventAsSelf: vi.fn(),
  NotAGuestError: class NotAGuestError extends Error {},
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { respondToGoogleEventAsSelf } from "~/lib/google-calendar";
import { submitCalendarAction } from "~/calendar/routes/calendar.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockRespond = respondToGoogleEventAsSelf as ReturnType<typeof vi.fn>;

function rsvpRequest(response = "accepted") {
  const body = new FormData();
  body.set("intent", "event-rsvp");
  body.set("destination", "link-1:primary");
  body.set("eventId", "evt-1");
  body.set("response", response);
  return new Request("http://localhost/calendar", { method: "POST", body });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } });
  mockPrisma.userCalendarLink.findFirst.mockResolvedValue({ id: "link-1" });
});

describe("submitCalendarAction — event-rsvp", () => {
  it("resolves to a 500 JSON error instead of rejecting when Google's RSVP write fails", async () => {
    mockRespond.mockRejectedValue(new Error("Google is down"));

    const res = await submitCalendarAction(rsvpRequest());

    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(500);
    const body = await res!.json();
    expect(typeof body.error).toBe("string");
  });

  it("succeeds normally when Google accepts the RSVP", async () => {
    mockRespond.mockResolvedValue(undefined);
    mockPrisma.scheduledMeeting.findFirst.mockResolvedValue(null);

    const res = await submitCalendarAction(rsvpRequest());

    expect(res).toBeNull();
  });
});
