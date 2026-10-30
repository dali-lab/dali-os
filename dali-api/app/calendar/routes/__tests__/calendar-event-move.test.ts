import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
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
vi.mock("~/lib/rooms.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/rooms.server")>()),
  retimeEventRoomBookings: vi.fn(async () => ({ ok: true })),
}));
vi.mock("~/lib/scheduled-meeting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/scheduled-meeting")>()),
  updateScheduledMeeting: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { patchGoogleCalendarEvent } from "~/lib/google-calendar";
import { updateScheduledMeeting } from "~/lib/scheduled-meeting";
import { submitCalendarAction } from "~/calendar/routes/calendar.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockUpdate = vi.mocked(updateScheduledMeeting);
const mockPatch = vi.mocked(patchGoogleCalendarEvent);

const START = "2026-10-19T14:00:00.000Z";
const END = "2026-10-19T15:00:00.000Z";

function moveRequest(fields: Record<string, string> = {}) {
  const body = new FormData();
  body.set("intent", "event-move");
  body.set("destination", "link-1:primary");
  body.set("eventId", "master_20261019T130000Z");
  body.set("recurringEventId", "master");
  body.set("startIso", START);
  body.set("endIso", END);
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("http://localhost/calendar", { method: "POST", body });
}

const meeting = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  title: "Weekly sync",
  selectedAt: new Date("2026-09-14T13:00:00.000Z"),
  externalEventId: "master",
  googleEventOrigin: "Created",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } } as never);
  mockPrisma.userCalendarLink!.findFirst!.mockResolvedValue({ id: "link-1" });
  mockPrisma.timeEntry!.updateMany!.mockResolvedValue({ count: 0 });
  mockPrisma.scheduledMeeting!.findFirst!.mockResolvedValue(null);
  mockPrisma.meetingException!.findUnique!.mockResolvedValue(null);
  mockUpdate.mockResolvedValue({ ok: true, meeting: {} as never, gcalError: null });
});

describe("submitCalendarAction event-move", () => {
  it("moves a meeting occurrence through updateScheduledMeeting scope this, not a raw patch", async () => {
    mockPrisma.scheduledMeeting!.findFirst!.mockResolvedValue(meeting());

    const res = await submitCalendarAction(moveRequest());

    expect(res).toBeNull();
    expect(mockUpdate).toHaveBeenCalledWith(
      "m1",
      "member-1",
      expect.objectContaining({
        title: "Weekly sync",
        durationMinutes: 60,
        startTime: START,
        editScope: "this",
        occurrenceStart: "2026-10-19T13:00:00.000Z",
        occurrenceEventId: "master_20261019T130000Z",
      }),
    );
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("keeps an occurrence's own title when it already has an exception", async () => {
    mockPrisma.scheduledMeeting!.findFirst!.mockResolvedValue(meeting());
    mockPrisma.meetingException!.findUnique!.mockResolvedValue({ overrideTitle: "Special one" });

    await submitCalendarAction(moveRequest());

    expect(mockUpdate.mock.calls[0]![2]).toMatchObject({ title: "Special one" });
  });

  it("keys a one-off meeting's move on its own start", async () => {
    mockPrisma.scheduledMeeting!.findFirst!.mockResolvedValue(meeting({ externalEventId: "solo" }));

    await submitCalendarAction(moveRequest({ eventId: "solo", recurringEventId: "" }));

    expect(mockUpdate.mock.calls[0]![2]).toMatchObject({
      editScope: "this",
      occurrenceStart: "2026-09-14T13:00:00.000Z",
    });
  });

  it("still patches Google for a tracked meeting, since DALI's update skips Google writes there", async () => {
    mockPrisma.scheduledMeeting!.findFirst!.mockResolvedValue(meeting({ googleEventOrigin: "Tracked" }));

    await submitCalendarAction(moveRequest());

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockPatch).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "master_20261019T130000Z", startIso: START, endIso: END }),
    );
  });

  it("falls back to the raw patch when the mover cannot edit the meeting in DALI", async () => {
    mockPrisma.scheduledMeeting!.findFirst!.mockResolvedValue(meeting());
    mockUpdate.mockResolvedValue({ ok: false, error: "Only the organizer or Core can edit this meeting", status: 403 });

    const res = await submitCalendarAction(moveRequest());

    expect(res).toBeNull();
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });

  it("surfaces other update failures and does not patch Google", async () => {
    mockPrisma.scheduledMeeting!.findFirst!.mockResolvedValue(meeting());
    mockUpdate.mockResolvedValue({ ok: false, error: "Not found", status: 404 });

    const res = await submitCalendarAction(moveRequest());

    expect(res!.status).toBe(404);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("uses the raw patch for an event that is not a meeting", async () => {
    const res = await submitCalendarAction(moveRequest());

    expect(res).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });

  it("uses the raw patch for an all-day move even when it is a meeting", async () => {
    mockPrisma.scheduledMeeting!.findFirst!.mockResolvedValue(meeting());

    await submitCalendarAction(moveRequest({ allDay: "1" }));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });
});
