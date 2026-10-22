import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
const requireMobileUser = vi.fn();
const listUpcomingMeetings = vi.fn();
const listMemberSummaries = vi.fn();

vi.mock("~/lib/mobile-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/mobile-auth.server")>()),
  requireMobileUser: (...a: unknown[]) => requireMobileUser(...a),
}));
vi.mock("~/lib/upcoming-meetings", () => ({ listUpcomingMeetings: (...a: unknown[]) => listUpcomingMeetings(...a) }));
vi.mock("~/lib/google-calendar", () => ({ fetchCalendarEvents: vi.fn().mockResolvedValue([]) }));
vi.mock("~/lib/mobile-members.server", () => ({ listMemberSummaries: (...a: unknown[]) => listMemberSummaries(...a) }));

import { prisma } from "~/lib/db";
import { loader } from "../api.mobile.calendar";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const meeting = (id: string, attendeeIds: string[]) => ({
  source: "meeting",
  id,
  scheduledMeetingId: id,
  occurrenceStart: "2026-10-20T18:00:00.000Z",
  title: id,
  startsAt: "2026-10-20T18:00:00.000Z",
  endsAt: "2026-10-20T19:00:00.000Z",
  location: null,
  meetingUrl: null,
  attendeeIds,
  description: null,
  externalEventId: null,
  iCalUID: null,
});

const request = new Request(
  "https://os.example/api/mobile/calendar?from=2026-10-18T00:00:00.000Z&to=2026-10-25T00:00:00.000Z",
);

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileUser.mockResolvedValue({ ok: true, userId: "u1" });
  mockPrisma.memberClass.findMany.mockResolvedValue([]);
  mockPrisma.notification.findMany.mockResolvedValue([]);
  listMemberSummaries.mockResolvedValue([{ id: "u2", name: "Kiran" }]);
});

describe("GET /api/mobile/calendar meeting ids", () => {
  it("names the DALI meeting and occurrence behind an event", async () => {
    listUpcomingMeetings.mockResolvedValue([meeting("m1", [])]);
    const res = (await loader({ request } as never)) as Response;
    expect((await res.json()).events[0]).toMatchObject({
      id: "dali:m1:2026-10-20T18:00:00.000Z",
      scheduledMeetingId: "m1",
      occurrenceStart: "2026-10-20T18:00:00.000Z",
    });
  });

  it("leaves them null for an interview", async () => {
    listUpcomingMeetings.mockResolvedValue([{ ...meeting("i1", []), source: "interview" }]);
    const res = (await loader({ request } as never)) as Response;
    expect((await res.json()).events[0]).toMatchObject({ category: "interview", scheduledMeetingId: null, occurrenceStart: null });
  });
});

describe("GET /api/mobile/calendar people", () => {
  it("returns a summary for each attendee across the week's events, once", async () => {
    listUpcomingMeetings.mockResolvedValue([meeting("m1", ["u1", "u2"]), meeting("m2", ["u2", "u3"])]);
    const res = (await loader({ request } as never)) as Response;
    expect((await res.json()).people).toEqual([{ id: "u2", name: "Kiran" }]);
    expect(listMemberSummaries).toHaveBeenCalledWith(["u1", "u2", "u3"]);
  });

  it("asks for nobody when no event has attendees", async () => {
    listUpcomingMeetings.mockResolvedValue([]);
    listMemberSummaries.mockResolvedValue([]);
    const res = (await loader({ request } as never)) as Response;
    expect(await res.json()).toEqual({ events: [], people: [] });
    expect(listMemberSummaries).toHaveBeenCalledWith([]);
  });
});
