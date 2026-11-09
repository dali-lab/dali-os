import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectNonMemberToPortal: vi.fn(async () => null),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/members/lib/community.server", () => ({ loadCommunity: vi.fn() }));
vi.mock("~/members/lib/community-events.server", () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  cancelEvent: vi.fn(),
  setRsvp: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { loadCommunity } from "~/members/lib/community.server";
import { cancelEvent, createEvent, setRsvp, updateEvent } from "~/members/lib/community-events.server";
import { action, handle, loader } from "../community";

const db = prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } };
const load = vi.mocked(loadCommunity);

const event = (id: string, source: "alumni" | "dali") => ({ id, source });
const community = (isAlumni: boolean) => ({
  viewer: { id: "u1", isAlumni, canHost: isAlumni },
  people: [],
  unplaced: 0,
  filterOptions: { classYears: [], roles: [], projects: [] },
  events: [event("a1", "alumni"), event("dali:m1:1", "dali")],
});

const runLoader = () => loader({ request: new Request("http://localhost/community"), params: {}, context: {} } as never);
function runAction(body: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) fd.set(k, v);
  return action({
    request: new Request("http://localhost/community", { method: "POST", body: fd }),
    params: {},
    context: {},
  } as never);
}
const statusOf = (res: unknown) => (res as { init?: { status?: number } }).init?.status;

const hostForm = {
  title: "Mixer",
  description: "",
  date: "2026-12-01",
  startTime: "18:00",
  endTime: "19:00",
  mode: "online",
  placeName: "",
  address: "",
  meetingUrl: "https://meet.example.edu/x",
  audience: "alumni",
  notifyNearby: "on",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  db.user.findUnique.mockResolvedValue({ timeZone: "America/New_York", openToCoffeeChats: true, openToResumeReviews: false });
});

describe("route handle", () => {
  it("fills the viewport for everyone", () => {
    expect(handle.fitViewport).toBe(true);
    expect(handle.bleedPane).toBe(true);
  });
});

describe("loader", () => {
  it("redirects visitors who are not signed in", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    const res = (await runLoader()) as Response;
    expect(res.status).toBe(302);
    expect(load).not.toHaveBeenCalled();
  });

  it("shows alumni both kinds of event under the title Home", async () => {
    load.mockResolvedValue(community(true) as never);
    const res = (await runLoader()) as { title: string; events: { id: string }[]; tz: string; openTo: unknown };
    expect(res.title).toBe("Home");
    expect(res.events.map((e) => e.id)).toEqual(["a1", "dali:m1:1"]);
    expect(res.tz).toBe("America/New_York");
    expect(res.openTo).toEqual({ coffeeChats: true, resumeReviews: false });
  });

  it("hides DALI events from members, who are invited to every meeting", async () => {
    load.mockResolvedValue(community(false) as never);
    const res = (await runLoader()) as { title: string; events: { id: string }[] };
    expect(res.title).toBe("Community");
    expect(res.events.map((e) => e.id)).toEqual(["a1"]);
  });
});

describe("action", () => {
  it("redirects visitors who are not signed in", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    expect(((await runAction({ intent: "rsvp" })) as Response).status).toBe(302);
  });

  it("rejects an unknown intent", async () => {
    await expect(runAction({ intent: "nope" })).rejects.toMatchObject({ status: 400 });
  });

  it("saves the open-to switches", async () => {
    expect(await runAction({ intent: "open-to", field: "coffeeChats", value: "on" })).toEqual({ ok: true });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { openToCoffeeChats: true } });
    await expect(runAction({ intent: "open-to", field: "other", value: "on" })).rejects.toMatchObject({ status: 400 });
  });

  it("creates an event with the times read in the viewer's zone", async () => {
    vi.mocked(createEvent).mockResolvedValue({ ok: true, id: "ev1" });
    expect(await runAction({ intent: "create-event", ...hostForm })).toEqual({ ok: true, id: "ev1" });
    expect(createEvent).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        title: "Mixer",
        startsAt: "2026-12-01T23:00:00.000Z",
        endsAt: "2026-12-02T00:00:00.000Z",
        notifyNearby: true,
        audience: "alumni",
      }),
      expect.any(Request),
    );
  });

  it("returns the server's reason with its status when posting fails", async () => {
    vi.mocked(createEvent).mockResolvedValue({ ok: false, status: 403, error: "Only alumni can host events." });
    const res = await runAction({ intent: "create-event", ...hostForm });
    expect(statusOf(res)).toBe(403);
    expect((res as { data: unknown }).data).toEqual({ ok: false, error: "Only alumni can host events." });
  });

  it("returns a validation error without calling the host lib when the date is missing", async () => {
    const res = await runAction({ intent: "create-event", ...hostForm, date: "" });
    expect(statusOf(res)).toBe(400);
    expect((res as { data: { error: string } }).data.error).toBe("Pick a date and a start and end time.");
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("updates, cancels and RSVPs through the matching lib call", async () => {
    vi.mocked(updateEvent).mockResolvedValue({ ok: true, id: "ev1" });
    vi.mocked(cancelEvent).mockResolvedValue({ ok: false, status: 403, error: "Only the host can change this event." });
    vi.mocked(setRsvp).mockResolvedValue({ ok: true, id: "ev1", going: true });

    expect(await runAction({ intent: "update-event", eventId: "ev1", ...hostForm })).toEqual({ ok: true, id: "ev1" });
    expect(updateEvent).toHaveBeenCalledWith("u1", "ev1", expect.objectContaining({ title: "Mixer" }), expect.any(Request));

    const cancelled = await runAction({ intent: "cancel-event", eventId: "ev1" });
    expect(statusOf(cancelled)).toBe(403);
    expect(cancelEvent).toHaveBeenCalledWith("u1", "ev1", expect.any(Request));

    await runAction({ intent: "rsvp", eventId: "ev1", going: "true" });
    expect(setRsvp).toHaveBeenLastCalledWith("u1", "ev1", true);
    await runAction({ intent: "rsvp", eventId: "ev1", going: "false" });
    expect(setRsvp).toHaveBeenLastCalledWith("u1", "ev1", false);
  });
});
