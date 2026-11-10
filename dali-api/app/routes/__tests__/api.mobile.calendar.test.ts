import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
const requireMobileUser = vi.fn();
const listUpcomingMeetings = vi.fn();
const listMemberSummaries = vi.fn();
const createScheduledMeeting = vi.fn();

vi.mock("~/lib/mobile-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/mobile-auth.server")>()),
  requireMobileUser: (...a: unknown[]) => requireMobileUser(...a),
}));
vi.mock("~/lib/upcoming-meetings", () => ({ listUpcomingMeetings: (...a: unknown[]) => listUpcomingMeetings(...a) }));
vi.mock("~/lib/google-calendar", () => ({ fetchCalendarEvents: vi.fn().mockResolvedValue([]) }));
vi.mock("~/lib/mobile-members.server", () => ({ listMemberSummaries: (...a: unknown[]) => listMemberSummaries(...a) }));
vi.mock("~/lib/scheduled-meeting", () => ({ createScheduledMeeting: (...a: unknown[]) => createScheduledMeeting(...a) }));

import { prisma } from "~/lib/db.server";
import { action, loader } from "../api.mobile.calendar";

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

describe("POST /api/mobile/calendar", () => {
  const event = { title: "Design crit", startTime: "2026-10-23T18:00:00.000Z", durationMinutes: 45 };
  const post = (body: unknown) =>
    new Request("https://os.example/api/mobile/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const create = (body: unknown) => action({ request: post(body) } as never) as Promise<Response>;

  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue({ daliEmail: "me@dali.dartmouth.edu", dartmouthEmail: null });
    mockPrisma.userCalendarLink.findFirst.mockResolvedValue({ id: "link1" });
    createScheduledMeeting.mockResolvedValue({ ok: true, meeting: { id: "m9" }, gcalError: null });
  });

  it("creates the meeting with you invited, on your linked Google calendar", async () => {
    const res = await create({ ...event, participantUserIds: ["u2", "u1"], location: "Sudikoff 004", addMeet: true });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "m9", addedToGoogle: true, googleError: null });
    expect(createScheduledMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        organizerId: "u1",
        organizerEmail: "me@dali.dartmouth.edu",
        title: "Design crit",
        durationMinutes: 45,
        startTime: "2026-10-23T18:00:00.000Z",
        scope: { type: "UserList", participantUserIds: ["u1", "u2"] },
        location: "Sudikoff 004",
        description: null,
        organizerCalendarLinkId: "link1",
        addMeet: true,
      }),
    );
    expect(mockPrisma.userCalendarLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", enabled: true } }),
    );
  });

  it("makes a just-you event when nobody else is invited", async () => {
    await create(event);
    expect(createScheduledMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { type: "UserList", participantUserIds: ["u1"] } }),
    );
  });

  it("keeps it off Google, and skips Meet, when asked", async () => {
    const res = await create({ ...event, addToGoogle: false, addMeet: true });
    expect(await res.json()).toMatchObject({ addedToGoogle: false });
    expect(mockPrisma.userCalendarLink.findFirst).not.toHaveBeenCalled();
    expect(createScheduledMeeting).toHaveBeenCalledWith(expect.objectContaining({ organizerCalendarLinkId: null, addMeet: false }));
  });

  it("still creates the meeting with no linked calendar", async () => {
    mockPrisma.userCalendarLink.findFirst.mockResolvedValue(null);
    const res = await create({ ...event, addMeet: true });
    expect(await res.json()).toMatchObject({ addedToGoogle: false });
    expect(createScheduledMeeting).toHaveBeenCalledWith(expect.objectContaining({ organizerCalendarLinkId: null, addMeet: false }));
  });

  it("reports a Google failure without failing the meeting", async () => {
    createScheduledMeeting.mockResolvedValue({ ok: true, meeting: { id: "m9" }, gcalError: "Token expired" });
    const res = await create(event);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "m9", addedToGoogle: false, googleError: "Token expired" });
  });

  it("passes a refusal on", async () => {
    createScheduledMeeting.mockResolvedValue({ ok: false, error: "Invalid start time" });
    const res = await create(event);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid start time" });
  });

  it.each([
    [{ ...event, title: " " }],
    [{ ...event, durationMinutes: 2 }],
    [{ ...event, startTime: "tomorrow" }],
  ])("rejects %j", async (body) => {
    expect((await create(body)).status).toBe(400);
    expect(createScheduledMeeting).not.toHaveBeenCalled();
  });

  it("needs an email to send invites from", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ daliEmail: null, dartmouthEmail: null });
    expect((await create(event)).status).toBe(400);
    expect(createScheduledMeeting).not.toHaveBeenCalled();
  });
});
