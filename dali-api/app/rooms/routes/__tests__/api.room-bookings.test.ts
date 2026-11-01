import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoomBookingUser = vi.fn();
const updateRoomBookingAsMember = vi.fn();
vi.mock("~/rooms/lib/access.server", () => ({ requireRoomBookingUser }));
vi.mock("~/lib/rooms.server", () => ({ updateRoomBookingAsMember }));

const { action } = await import("~/rooms/routes/api.room-bookings.$id");

const start = "2030-03-13T18:00:00.000Z";
const end = "2030-03-13T19:00:00.000Z";

const patch = (body: unknown, method = "PATCH") =>
  action({
    request: new Request("http://localhost/api/room-bookings/b1", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    }),
    params: { id: "b1" },
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  requireRoomBookingUser.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  updateRoomBookingAsMember.mockResolvedValue({ ok: true, value: { start: new Date(start), end: new Date(end) } });
});

describe("PATCH /api/room-bookings/:id", () => {
  it("hands the edit to the server rules as the signed-in member", async () => {
    const res = (await patch({ start, end, roomId: "r2", title: "Retro", scope: "this", occurrenceStart: start })) as Response;
    expect(res.status).toBe(200);
    expect(updateRoomBookingAsMember).toHaveBeenCalledWith("b1", "u1", {
      start: new Date(start),
      end: new Date(end),
      roomId: "r2",
      title: "Retro",
      scope: "this",
      occurrenceStart: new Date(start),
    });
  });

  it("passes a null title through to clear it", async () => {
    await patch({ start, end, title: null });
    expect(updateRoomBookingAsMember.mock.calls[0]![2]).toMatchObject({ title: null });
  });

  it("rejects a body without times", async () => {
    const res = (await patch({ title: "Retro" })) as Response;
    expect(res.status).toBe(400);
    expect(updateRoomBookingAsMember).not.toHaveBeenCalled();
  });

  it("has no 'following' scope", async () => {
    const res = (await patch({ start, end, scope: "following" })) as Response;
    expect(res.status).toBe(400);
  });

  it("returns the auth gate's response", async () => {
    const denied = new Response(null, { status: 401 });
    requireRoomBookingUser.mockResolvedValue({ ok: false, response: denied });
    await expect(patch({ start, end })).resolves.toBe(denied);
  });

  it("carries a refusal's status and reason", async () => {
    updateRoomBookingAsMember.mockResolvedValue({ ok: false, error: "Forbidden", status: 403 });
    const res = (await patch({ start, end })) as Response;
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("405s anything but PATCH", async () => {
    const res = (await patch({ start, end }, "POST")) as Response;
    expect(res.status).toBe(405);
  });
});
