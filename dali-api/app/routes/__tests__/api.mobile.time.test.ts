import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
const requireMobileUser = vi.fn();
const getUserRoleInstances = vi.fn();
const addTimeEntry = vi.fn();
const updateTimeEntry = vi.fn();
const deleteTimeEntry = vi.fn();

vi.mock("~/lib/mobile-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/mobile-auth.server")>()),
  requireMobileUser: (...a: unknown[]) => requireMobileUser(...a),
}));
vi.mock("~/lib/roles", () => ({ getUserRoleInstances: (...a: unknown[]) => getUserRoleInstances(...a) }));
vi.mock("~/lib/time-entries.server", () => ({
  addTimeEntry: (...a: unknown[]) => addTimeEntry(...a),
  updateTimeEntry: (...a: unknown[]) => updateTimeEntry(...a),
  deleteTimeEntry: (...a: unknown[]) => deleteTimeEntry(...a),
}));

import { prisma } from "~/lib/db";
import { loader, action } from "../api.mobile.time";
import { action as entryAction } from "../api.mobile.time.$id";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const get = (query = "") => new Request(`https://os.example/api/mobile/time${query}`);
const send = (method: string, body: unknown, path = "/api/mobile/time") =>
  new Request(`https://os.example${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const row = (over: Record<string, unknown>) => ({
  id: "e",
  source: "Manual",
  date: new Date("2026-10-20T00:00:00.000Z"),
  hours: 1,
  note: null,
  startTime: null,
  endTime: null,
  assignmentType: "Project",
  roleRefId: "pa1",
  projectId: "p1",
  scheduledMeetingId: null,
  occurrenceStart: null,
  meeting: null,
  ...over,
});

const addBody = {
  date: "2026-10-21",
  hours: 2,
  assignmentType: "Project",
  roleRefId: "pa1",
  note: "Guides",
  startTime: "2026-10-21T13:00:00.000Z",
  endTime: "2026-10-21T15:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T15:00:00.000Z"));
  requireMobileUser.mockResolvedValue({ ok: true, userId: "u1" });
  mockPrisma.user.findUnique.mockResolvedValue({ timeZone: "America/New_York" });
  getUserRoleInstances.mockResolvedValue([
    { assignmentType: "Project", roleRefId: "pa1", label: "DALI OS Fullstack Dev", projectId: "p1" },
    { assignmentType: "Core", roleRefId: "ca1", label: "Delivery Lead" },
  ]);
  mockPrisma.timeEntry.findMany.mockResolvedValue([]);
});

describe("GET /api/mobile/time", () => {
  it("returns the auth guard's response when the member isn't let in", async () => {
    const response = new Response(null, { status: 404 });
    requireMobileUser.mockResolvedValue({ ok: false, response });
    expect(await loader({ request: get() } as never)).toBe(response);
  });

  it("covers today's pay period and lists the member's roles", async () => {
    const res = (await loader({ request: get() } as never)) as Response;
    expect(await res.json()).toMatchObject({
      today: "2026-10-22",
      period: { start: "2026-10-11", end: "2026-10-24" },
      roles: [
        { assignmentType: "Project", roleRefId: "pa1", label: "DALI OS Fullstack Dev", detail: "Project", projectId: "p1" },
        { assignmentType: "Core", roleRefId: "ca1", label: "Delivery Lead", detail: "Core", projectId: null },
      ],
      entries: [],
    });
  });

  it("uses the member's own day for today, not the UTC one", async () => {
    vi.setSystemTime(new Date("2026-10-25T02:00:00.000Z"));
    const res = (await loader({ request: get() } as never)) as Response;
    expect(await res.json()).toMatchObject({ today: "2026-10-24", period: { start: "2026-10-11", end: "2026-10-24" } });
  });

  it("can load another period by date", async () => {
    const res = (await loader({ request: get("?date=2026-10-05") } as never)) as Response;
    expect(await res.json()).toMatchObject({ period: { start: "2026-09-27", end: "2026-10-10" } });
  });

  it("rejects a malformed date", async () => {
    const res = (await loader({ request: get("?date=Oct%205") } as never)) as Response;
    expect(res.status).toBe(400);
  });

  it("keeps only entries whose local day falls in the period", async () => {
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      row({ id: "in", date: new Date("2026-10-11T00:00:00.000Z") }),
      row({ id: "before", date: new Date("2026-10-10T00:00:00.000Z") }),
      // 9pm on Oct 24 in New York, already Oct 25 in UTC.
      row({
        id: "late-meeting",
        source: "Meeting",
        date: new Date("2026-10-25T01:00:00.000Z"),
        startTime: new Date("2026-10-25T01:00:00.000Z"),
        endTime: new Date("2026-10-25T02:00:00.000Z"),
        scheduledMeetingId: "m1",
        occurrenceStart: new Date("2026-10-25T01:00:00.000Z"),
        meeting: { title: "DALI OS Meeting" },
      }),
      row({ id: "after", date: new Date("2026-10-25T00:00:00.000Z") }),
    ]);
    const res = (await loader({ request: get() } as never)) as Response;
    const { entries } = await res.json();
    expect(entries.map((e: { id: string; day: string }) => [e.id, e.day])).toEqual([
      ["in", "2026-10-11"],
      ["late-meeting", "2026-10-24"],
    ]);
    expect(entries[1]).toMatchObject({
      source: "Meeting",
      scheduledMeetingId: "m1",
      occurrenceStart: "2026-10-25T01:00:00.000Z",
      meetingTitle: "DALI OS Meeting",
      startTime: "2026-10-25T01:00:00.000Z",
    });
  });

  it("queries a day either side of the period for the member only", async () => {
    await loader({ request: get() } as never);
    expect(mockPrisma.timeEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "u1",
          date: { gte: new Date("2026-10-10T00:00:00.000Z"), lt: new Date("2026-10-26T00:00:00.000Z") },
        },
      }),
    );
  });
});

describe("POST /api/mobile/time", () => {
  it("adds the entry for the signed-in member", async () => {
    addTimeEntry.mockResolvedValue({ ok: true, entry: { id: "new" } });
    const res = (await action({ request: send("POST", addBody) } as never)) as Response;
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "new" });
    expect(addTimeEntry).toHaveBeenCalledWith("u1", addBody);
  });

  it("passes a meeting id through so the hours link to that meeting", async () => {
    addTimeEntry.mockResolvedValue({ ok: true, entry: { id: "new" } });
    await action({ request: send("POST", { ...addBody, scheduledMeetingId: "m1" }) } as never);
    expect(addTimeEntry).toHaveBeenCalledWith("u1", { ...addBody, scheduledMeetingId: "m1" });
  });

  it("surfaces the service's error and status", async () => {
    addTimeEntry.mockResolvedValue({ ok: false, error: "Invalid role", status: 400 });
    const res = (await action({ request: send("POST", addBody) } as never)) as Response;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid role" });
  });

  it("rejects a body missing the role without calling the service", async () => {
    const { roleRefId: _r, ...rest } = addBody;
    const res = (await action({ request: send("POST", rest) } as never)) as Response;
    expect(res.status).toBe(400);
    expect(addTimeEntry).not.toHaveBeenCalled();
  });

  it("only accepts POST", async () => {
    const res = (await action({ request: send("PUT", addBody) } as never)) as Response;
    expect(res.status).toBe(405);
  });
});

describe("PATCH and DELETE /api/mobile/time/:id", () => {
  const path = "/api/mobile/time/e1";

  it("updates the entry with the id from the URL", async () => {
    updateTimeEntry.mockResolvedValue({ ok: true, entry: { id: "e1" } });
    const patch = { note: "Code review", hours: 1, startTime: addBody.startTime, endTime: "2026-10-21T14:00:00.000Z" };
    const res = (await entryAction({ request: send("PATCH", patch, path), params: { id: "e1" } } as never)) as Response;
    expect(res.status).toBe(200);
    expect(updateTimeEntry).toHaveBeenCalledWith("u1", { ...patch, id: "e1" });
  });

  it("ignores an id in the body", async () => {
    updateTimeEntry.mockResolvedValue({ ok: true, entry: { id: "e1" } });
    await entryAction({ request: send("PATCH", { id: "other", note: "x" }, path), params: { id: "e1" } } as never);
    expect(updateTimeEntry).toHaveBeenCalledWith("u1", { note: "x", id: "e1" });
  });

  it("deletes the entry", async () => {
    deleteTimeEntry.mockResolvedValue({ ok: true, entry: { id: "e1" } });
    const req = new Request(`https://os.example${path}`, { method: "DELETE" });
    const res = (await entryAction({ request: req, params: { id: "e1" } } as never)) as Response;
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteTimeEntry).toHaveBeenCalledWith("u1", "e1");
  });

  it("404s someone else's entry", async () => {
    deleteTimeEntry.mockResolvedValue({ ok: false, error: "Not found", status: 404 });
    const req = new Request(`https://os.example${path}`, { method: "DELETE" });
    const res = (await entryAction({ request: req, params: { id: "e1" } } as never)) as Response;
    expect(res.status).toBe(404);
  });

  it("refuses other methods", async () => {
    const res = (await entryAction({ request: send("POST", {}, path), params: { id: "e1" } } as never)) as Response;
    expect(res.status).toBe(405);
  });
});
