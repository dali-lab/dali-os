import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    communityEvent: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    communityEventRsvp: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/geocode.server", () => ({ geocodePlace: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { getUserRoles } from "~/lib/roles";
import { geocodePlace } from "~/lib/geocode.server";
import { notify } from "~/lib/notify.server";
import { cancelEvent, createEvent, getEventForCalendar, setRsvp, updateEvent } from "../community-events.server";

const db = prisma as unknown as {
  user: Record<"findMany" | "findUnique", ReturnType<typeof vi.fn>>;
  communityEvent: Record<"create" | "findUnique" | "update", ReturnType<typeof vi.fn>>;
  communityEventRsvp: Record<"upsert" | "deleteMany", ReturnType<typeof vi.fn>>;
};
const roles = getUserRoles as unknown as ReturnType<typeof vi.fn>;
const geocode = geocodePlace as unknown as ReturnType<typeof vi.fn>;
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;

const HANOVER = { lat: 43.7044, lng: -72.2887 };
const future = (days: number, hours = 0) => new Date(Date.now() + days * 86_400_000 + hours * 3_600_000).toISOString();

const inPerson = (over: Record<string, unknown> = {}) => ({
  title: "Alumni mixer",
  startsAt: future(7),
  endsAt: future(7, 2),
  mode: "inPerson",
  placeName: "Cafe Nero",
  address: "1 Main St, Hanover NH",
  audience: "alumni_and_students",
  notifyNearby: false,
  ...over,
});
const online = (over: Record<string, unknown> = {}) =>
  ({ title: "Office hours", startsAt: future(3), endsAt: future(3, 1), mode: "online", meetingUrl: "https://meet.example.edu/x", audience: "alumni", ...over });

const asRoles = (r: { isAlumni?: boolean; isAdmin?: boolean }) =>
  roles.mockResolvedValue({ isAlumni: false, isAdmin: false, ...r });

beforeEach(() => {
  vi.resetAllMocks();
  asRoles({ isAlumni: true });
  geocode.mockResolvedValue(HANOVER);
  db.communityEvent.create.mockResolvedValue({ id: "ev1" });
  db.user.findMany.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue({ firstName: "Ada", lastName: "Lovelace", membershipStatus: "Alumni" });
});

describe("createEvent access", () => {
  it("lets only alumni host", async () => {
    asRoles({ isAlumni: false });
    expect(await createEvent("u1", inPerson())).toEqual({ ok: false, status: 403, error: "Only alumni can host events." });
    expect(db.communityEvent.create).not.toHaveBeenCalled();
  });
});

describe("createEvent validation", () => {
  const rejects = async (input: unknown, message: RegExp) => {
    const res = await createEvent("u1", input);
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect((res as { error: string }).error).toMatch(message);
    expect(db.communityEvent.create).not.toHaveBeenCalled();
  };

  it("needs a name", () => rejects(inPerson({ title: "  " }), /name/i));
  it("caps the name length", () => rejects(inPerson({ title: "x".repeat(121) }), /120/));
  it("needs a start in the future", () => rejects(inPerson({ startsAt: future(-1), endsAt: future(1) }), /future/));
  it("needs the end after the start", () => rejects(inPerson({ endsAt: future(7) }), /after the start/));
  it("needs a valid start date", () => rejects(inPerson({ startsAt: "soon" }), /start/i));
  it("needs a place name for in-person events", () => rejects(inPerson({ placeName: "" }), /place name/));
  it("needs an http or https link for online events", async () => {
    await rejects(online({ meetingUrl: "" }), /http/);
    await rejects(online({ meetingUrl: "ftp://files.example.edu" }), /http/);
    await rejects(online({ meetingUrl: "not a url" }), /http/);
  });
  it("rejects an audience it does not know", () => rejects(inPerson({ audience: "everyone" }), /./));

  it("says so when the place cannot be found", async () => {
    geocode.mockResolvedValue(null);
    await rejects(inPerson(), /couldn't find that place/);
  });
});

describe("createEvent writes", () => {
  it("saves an in-person event at the geocoded spot", async () => {
    const input = inPerson({ description: "  Come say hi  " });
    expect(await createEvent("u1", input)).toEqual({ ok: true, id: "ev1" });
    expect(geocode).toHaveBeenCalledWith("Cafe Nero, 1 Main St, Hanover NH");
    expect(db.communityEvent.create).toHaveBeenCalledWith({
      data: {
        hostId: "u1",
        title: "Alumni mixer",
        description: "Come say hi",
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        audience: "alumni_and_students",
        notifyNearby: false,
        online: false,
        meetingUrl: null,
        placeName: "Cafe Nero",
        address: "1 Main St, Hanover NH",
        lat: HANOVER.lat,
        lng: HANOVER.lng,
      },
      select: { id: true },
    });
  });

  it("saves an online event with a link and no place", async () => {
    await createEvent("u1", online());
    expect(geocode).not.toHaveBeenCalled();
    expect(db.communityEvent.create.mock.calls[0][0].data).toMatchObject({
      online: true,
      meetingUrl: "https://meet.example.edu/x",
      placeName: null,
      lat: null,
      lng: null,
      audience: "alumni",
    });
  });
});

describe("createEvent nearby alerts", () => {
  const near = { id: "near", currentLocationLat: 43.7, currentLocationLng: -72.3 };
  const boston = { id: "boston", currentLocationLat: 42.36, currentLocationLng: -71.06 };

  it("sends nothing unless the host turned on Tell people nearby", async () => {
    db.user.findMany.mockResolvedValue([near]);
    await createEvent("u1", inPerson({ notifyNearby: false }));
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("sends nothing for an online event, which has no place", async () => {
    await createEvent("u1", online({ notifyNearby: true }));
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("tells only people within 50 km, never the host, once per person", async () => {
    db.user.findMany.mockResolvedValue([near, boston, { id: "u1", currentLocationLat: 43.7, currentLocationLng: -72.3 }]);
    await createEvent("u1", inPerson({ notifyNearby: true }));
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const call = mockNotify.mock.calls[0][0];
    expect(call.eventType).toBe("community.event_nearby");
    expect(call.recipients).toEqual([{ userId: "near" }]);
    expect(call.createdByUserId).toBe("u1");
    expect(call.message.dedupKey).toBe("community.event_nearby:ev1");
    expect(call.message.link).toBe("/community?event=ev1");
    expect(call.message.vars.personName).toBe("Ada Lovelace");
    expect(call.message.vars.itemDetail).toContain("Alumni mixer");
    expect(call.message.vars.itemDetail).toContain("Cafe Nero");
    expect(db.user.findMany.mock.calls[0][0].where.id).toEqual({ not: "u1" });
  });

  it("limits an alumni-only event to alumni", async () => {
    await createEvent("u1", inPerson({ notifyNearby: true, audience: "alumni" }));
    expect(db.user.findMany.mock.calls[0][0].where.membershipStatus).toBe("Alumni");
    await createEvent("u1", inPerson({ notifyNearby: true }));
    expect(db.user.findMany.mock.calls[1][0].where.membershipStatus).toBeUndefined();
  });

  it("sends nothing when nobody is within range", async () => {
    db.user.findMany.mockResolvedValue([boston]);
    await createEvent("u1", inPerson({ notifyNearby: true }));
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("still posts the event when the alert fails", async () => {
    db.user.findMany.mockResolvedValue([near]);
    mockNotify.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await createEvent("u1", inPerson({ notifyNearby: true }))).toEqual({ ok: true, id: "ev1" });
  });
});

describe("updateEvent", () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    id: "ev1",
    hostId: "u1",
    cancelledAt: null,
    startsAt: new Date(Date.now() + 7 * 86_400_000),
    endsAt: new Date(Date.now() + 7 * 86_400_000 + 7_200_000),
    online: false,
    placeName: "Cafe Nero",
    address: "1 Main St",
    lat: 1,
    lng: 2,
    ...over,
  });

  it("is not found for an unknown event", async () => {
    db.communityEvent.findUnique.mockResolvedValue(null);
    expect(await updateEvent("u1", "nope", inPerson())).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses someone who is neither the host nor an admin", async () => {
    db.communityEvent.findUnique.mockResolvedValue(stored());
    expect(await updateEvent("u2", "ev1", inPerson())).toMatchObject({ ok: false, status: 403 });
    expect(db.communityEvent.update).not.toHaveBeenCalled();
  });

  it("lets the host edit, and geocodes only when the place changed", async () => {
    const row = stored();
    db.communityEvent.findUnique.mockResolvedValue(row);
    const input = inPerson({ startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), placeName: "Cafe Nero", address: "1 Main St", title: "Renamed" });
    expect(await updateEvent("u1", "ev1", input)).toEqual({ ok: true, id: "ev1" });
    expect(geocode).not.toHaveBeenCalled();
    expect(db.communityEvent.update.mock.calls[0][0].data).toMatchObject({ title: "Renamed", lat: 1, lng: 2 });

    await updateEvent("u1", "ev1", { ...input, placeName: "Other place" });
    expect(geocode).toHaveBeenCalledWith("Other place, 1 Main St");
    expect(db.communityEvent.update.mock.calls[1][0].data).toMatchObject({ placeName: "Other place", lat: HANOVER.lat });
  });

  it("lets an admin edit", async () => {
    asRoles({ isAdmin: true });
    db.communityEvent.findUnique.mockResolvedValue(stored());
    expect(await updateEvent("admin", "ev1", inPerson())).toMatchObject({ ok: true });
  });

  it("refuses to edit a cancelled or finished event", async () => {
    db.communityEvent.findUnique.mockResolvedValue(stored({ cancelledAt: new Date() }));
    expect(await updateEvent("u1", "ev1", inPerson())).toMatchObject({ ok: false, status: 409 });
    db.communityEvent.findUnique.mockResolvedValue(stored({ endsAt: new Date(Date.now() - 1000) }));
    expect(await updateEvent("u1", "ev1", inPerson())).toMatchObject({ ok: false, status: 409 });
  });

  it("requires a future start only when the start moved", async () => {
    const row = stored({ startsAt: new Date(Date.now() - 3_600_000) });
    db.communityEvent.findUnique.mockResolvedValue(row);
    const kept = inPerson({ startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), placeName: "Cafe Nero", address: "1 Main St" });
    expect(await updateEvent("u1", "ev1", kept)).toMatchObject({ ok: true });
    expect(await updateEvent("u1", "ev1", { ...kept, startsAt: future(-1) })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("cancelEvent", () => {
  const stored = (over: Record<string, unknown> = {}) => ({ id: "ev1", hostId: "u1", cancelledAt: null, ...over });

  it("lets the host cancel, stamping the time", async () => {
    db.communityEvent.findUnique.mockResolvedValue(stored());
    expect(await cancelEvent("u1", "ev1")).toEqual({ ok: true, id: "ev1" });
    expect(db.communityEvent.update).toHaveBeenCalledWith({
      where: { id: "ev1" },
      data: { cancelledAt: expect.any(Date) },
    });
  });

  it("lets an admin cancel", async () => {
    asRoles({ isAdmin: true });
    db.communityEvent.findUnique.mockResolvedValue(stored());
    expect(await cancelEvent("admin", "ev1")).toMatchObject({ ok: true });
    expect(db.communityEvent.update).toHaveBeenCalled();
  });

  it("refuses anyone else", async () => {
    db.communityEvent.findUnique.mockResolvedValue(stored());
    expect(await cancelEvent("u2", "ev1")).toMatchObject({ ok: false, status: 403 });
    expect(db.communityEvent.update).not.toHaveBeenCalled();
  });

  it("does nothing a second time", async () => {
    db.communityEvent.findUnique.mockResolvedValue(stored({ cancelledAt: new Date() }));
    expect(await cancelEvent("u1", "ev1")).toMatchObject({ ok: true });
    expect(db.communityEvent.update).not.toHaveBeenCalled();
  });
});

describe("setRsvp", () => {
  const ev = (over: Record<string, unknown> = {}) => ({
    audience: "alumni_and_students",
    cancelledAt: null,
    endsAt: new Date(Date.now() + 86_400_000),
    ...over,
  });
  const student = { membershipStatus: "Active" };
  const alum = { membershipStatus: "Alumni" };

  it("records going once per person", async () => {
    db.communityEvent.findUnique.mockResolvedValue(ev());
    db.user.findUnique.mockResolvedValue(student);
    expect(await setRsvp("u2", "ev1", true)).toEqual({ ok: true, id: "ev1", going: true });
    expect(db.communityEventRsvp.upsert).toHaveBeenCalledWith({
      where: { eventId_userId: { eventId: "ev1", userId: "u2" } },
      create: { eventId: "ev1", userId: "u2" },
      update: {},
    });
  });

  it("keeps students out of alumni-only events but not alumni", async () => {
    db.communityEvent.findUnique.mockResolvedValue(ev({ audience: "alumni" }));
    db.user.findUnique.mockResolvedValue(student);
    expect(await setRsvp("u2", "ev1", true)).toMatchObject({ ok: false, status: 403 });
    expect(db.communityEventRsvp.upsert).not.toHaveBeenCalled();
    db.user.findUnique.mockResolvedValue(alum);
    expect(await setRsvp("u3", "ev1", true)).toMatchObject({ ok: true });
  });

  it("refuses cancelled, finished and missing events", async () => {
    db.user.findUnique.mockResolvedValue(alum);
    db.communityEvent.findUnique.mockResolvedValue(ev({ cancelledAt: new Date() }));
    expect(await setRsvp("u2", "ev1", true)).toMatchObject({ ok: false, status: 409 });
    db.communityEvent.findUnique.mockResolvedValue(ev({ endsAt: new Date(Date.now() - 1000) }));
    expect(await setRsvp("u2", "ev1", true)).toMatchObject({ ok: false, status: 409 });
    db.communityEvent.findUnique.mockResolvedValue(null);
    expect(await setRsvp("u2", "ev1", true)).toMatchObject({ ok: false, status: 404 });
    expect(db.communityEventRsvp.upsert).not.toHaveBeenCalled();
  });

  it("removes the RSVP when they can't go, even after the event is cancelled", async () => {
    expect(await setRsvp("u2", "ev1", false)).toEqual({ ok: true, id: "ev1", going: false });
    expect(db.communityEventRsvp.deleteMany).toHaveBeenCalledWith({ where: { eventId: "ev1", userId: "u2" } });
    expect(db.communityEvent.findUnique).not.toHaveBeenCalled();
  });
});
