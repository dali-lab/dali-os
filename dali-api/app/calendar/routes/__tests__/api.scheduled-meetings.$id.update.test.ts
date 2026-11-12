import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(async () => false),
  forbidden: () => new Response("forbidden", { status: 403 }),
}));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: vi.fn(() => null),
}));
vi.mock("~/calendar/lib/scheduled-meeting.server", () => ({ updateScheduledMeeting: vi.fn() }));
vi.mock("~/rooms/lib/rooms.server", () => ({ assertMeetingRoomsFree: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth, isNonMember } from "~/lib/auth";
import { handlePreflight } from "~/lib/cors";
import { updateScheduledMeeting } from "~/calendar/lib/scheduled-meeting.server";
import { assertMeetingRoomsFree } from "~/rooms/lib/rooms.server";
import { MAX_GUEST_EMAILS } from "~/calendar/lib/guest-emails";
import { action } from "../api.scheduled-meetings.$id.update";

const findMeeting = vi.mocked(prisma.scheduledMeeting.findUnique);
const update = vi.mocked(updateScheduledMeeting);
const roomsFree = vi.mocked(assertMeetingRoomsFree);

const START = "2026-11-10T15:00:00.000Z";

function post(body: unknown, method = "POST") {
  return action({
    request: new Request("http://os.test/api/scheduled-meetings/m1/update", {
      method,
      headers: { "content-type": "application/json" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
    params: { id: "m1" },
  } as never) as Promise<Response>;
}

const base = { scopeType: "None", title: "Sync", durationMinutes: 30 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(handlePreflight).mockReturnValue(null);
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "org-1" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  findMeeting.mockResolvedValue({ rooms: [] } as never);
  roomsFree.mockResolvedValue({ ok: true } as never);
  update.mockResolvedValue({ ok: true, meeting: { id: "m1" }, gcalError: null } as never);
});

describe("POST /api/scheduled-meetings/:id/update", () => {
  it("returns the preflight response before touching auth", async () => {
    vi.mocked(handlePreflight).mockReturnValue(new Response(null, { status: 204 }));

    expect((await post(base)).status).toBe(204);
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it("returns the auth response when signed out", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as never);

    expect((await post(base)).status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a non-member", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);

    expect((await post(base)).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("405s anything but POST", async () => {
    expect((await post(null, "GET")).status).toBe(405);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty title", { ...base, title: "   " }],
    ["a title over 200 characters", { ...base, title: "x".repeat(201) }],
    ["a duration under 5 minutes", { ...base, durationMinutes: 4 }],
    ["a duration over 8 hours", { ...base, durationMinutes: 481 }],
    ["a non-integer duration", { ...base, durationMinutes: 30.5 }],
    ["a Group scope with no groupId", { ...base, scopeType: "Group" }],
    ["a UserList scope with no participants", { ...base, scopeType: "UserList", participantUserIds: [] }],
    ["an unknown scope", { ...base, scopeType: "Everyone" }],
    ["a malformed start time", { ...base, startTime: "tomorrow" }],
    ["more than 10 rooms", { ...base, roomIds: Array.from({ length: 11 }, (_, i) => `r${i}`) }],
    ["an invalid guest email", { ...base, guestEmails: ["not-an-email"] }],
    ["too many guest emails", { ...base, guestEmails: Array.from({ length: MAX_GUEST_EMAILS + 1 }, (_, i) => `g${i}@example.edu`) }],
  ])("rejects %s with a 400 and writes nothing", async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("maps a None scope and passes the edit fields through as the signed-in user", async () => {
    const res = await post({
      ...base,
      title: "  Sync  ",
      startTime: START,
      recurrenceRule: "RRULE:FREQ=WEEKLY",
      location: "",
      description: "Agenda",
      guestEmails: ["ada@example.edu"],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, meeting: { id: "m1" }, gcalError: null });
    expect(update).toHaveBeenCalledWith("m1", "org-1", {
      title: "Sync",
      durationMinutes: 30,
      scope: { type: "None" },
      startTime: START,
      recurrenceRule: "RRULE:FREQ=WEEKLY",
      location: "",
      description: "Agenda",
      roomIds: undefined,
      guestEmails: ["ada@example.edu"],
    });
  });

  it("keeps the extra guests on a Group scope", async () => {
    await post({ ...base, scopeType: "Group", groupId: "g1", extraUserIds: ["u9"] });

    expect(update.mock.calls[0]![2].scope).toEqual({ type: "Group", groupId: "g1", extraUserIds: ["u9"] });
  });

  it("maps a UserList scope to its participants", async () => {
    await post({ ...base, scopeType: "UserList", participantUserIds: ["u1", "u2"] });

    expect(update.mock.calls[0]![2].scope).toEqual({ type: "UserList", participantUserIds: ["u1", "u2"] });
  });

  it("de-duplicates the requested rooms", async () => {
    await post({ ...base, roomIds: ["r1", "r1", "r2"] });

    expect(update.mock.calls[0]![2].roomIds).toEqual(["r1", "r2"]);
  });

  it("checks the rooms a retimed meeting already holds, flagging none as new", async () => {
    findMeeting.mockResolvedValue({ rooms: [{ id: "r1" }] } as never);

    await post({ ...base, startTime: START, recurrenceRule: "RRULE:FREQ=WEEKLY" });

    expect(roomsFree).toHaveBeenCalledWith({
      roomIds: ["r1"],
      newRoomIds: [],
      meetingId: "m1",
      selectedAt: new Date(START),
      durationMinutes: 30,
      recurrenceRule: "RRULE:FREQ=WEEKLY",
    });
    expect(update.mock.calls[0]![2].roomIds).toBeUndefined();
  });

  it("flags only rooms not already held as new when the edit changes the room list", async () => {
    findMeeting.mockResolvedValue({ rooms: [{ id: "r1" }] } as never);

    await post({ ...base, startTime: START, roomIds: ["r1", "r2"] });

    expect(roomsFree).toHaveBeenCalledWith(
      expect.objectContaining({ roomIds: ["r1", "r2"], newRoomIds: ["r2"], recurrenceRule: null }),
    );
  });

  it("skips the room check without a new start time", async () => {
    findMeeting.mockResolvedValue({ rooms: [{ id: "r1" }] } as never);

    await post(base);

    expect(roomsFree).not.toHaveBeenCalled();
  });

  it("skips the room check when the meeting ends up with no rooms", async () => {
    await post({ ...base, startTime: START, roomIds: [] });

    expect(roomsFree).not.toHaveBeenCalled();
    expect(update.mock.calls[0]![2].roomIds).toEqual([]);
  });

  it("returns the room conflict and does not update", async () => {
    roomsFree.mockResolvedValue({ ok: false, error: "Room taken", status: 409 } as never);

    const res = await post({ ...base, startTime: START, roomIds: ["r1"] });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Room taken" });
    expect(update).not.toHaveBeenCalled();
  });

  it("passes the update's refusal status through, e.g. a non-organizer", async () => {
    update.mockResolvedValue({ ok: false, error: "Only the organizer or Core can edit this meeting", status: 403 } as never);

    const res = await post(base);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the organizer or Core can edit this meeting" });
  });

  it("reports a Google sync failure alongside a saved edit", async () => {
    update.mockResolvedValue({ ok: true, meeting: { id: "m1" }, gcalError: "boom" } as never);

    expect(await (await post(base)).json()).toMatchObject({ ok: true, gcalError: "boom" });
  });
});
