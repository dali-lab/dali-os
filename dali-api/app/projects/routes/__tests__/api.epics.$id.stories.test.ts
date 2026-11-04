import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));

import { requireProjectEditAccess } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { action } from "~/projects/routes/api.epics.$id.stories";

const EPIC_ID = "epic-1";
const PROJECT_ID = "proj-1";
const m = prisma as any;

function call(method: string, body?: unknown, rawBody?: string) {
  const request = new Request(`http://localhost/api/epics/${EPIC_ID}/stories`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(rawBody !== undefined
      ? { body: rawBody }
      : body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),
  });
  return action({ request, params: { id: EPIC_ID } } as any) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: true } as any);
  m.epic = { findUnique: vi.fn().mockResolvedValue({ id: EPIC_ID, projectId: PROJECT_ID }) };
  m.userStory = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "new-story" }),
  };
});

describe("access", () => {
  it("rejects non-POST with 405", async () => {
    expect((await call("GET")).status).toBe(405);
    expect(m.epic.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown epic", async () => {
    m.epic.findUnique.mockResolvedValue(null);
    expect((await call("POST", { title: "x" })).status).toBe(404);
    expect(requireProjectEditAccess).not.toHaveBeenCalled();
  });

  it("checks edit access against the epic's project and creates nothing when denied", async () => {
    vi.mocked(requireProjectEditAccess).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    } as any);
    const res = await call("POST", { title: "x" });
    expect(res.status).toBe(403);
    expect(requireProjectEditAccess).toHaveBeenCalledWith(expect.any(Request), PROJECT_ID);
    expect(m.userStory.create).not.toHaveBeenCalled();
  });
});

describe("validation", () => {
  it("rejects malformed JSON", async () => {
    expect((await call("POST", undefined, "{bad")).status).toBe(400);
  });

  it.each([
    ["missing title", {}],
    ["non-string title", { title: 3 }],
    ["non-string notes", { title: "a", notes: 3 }],
    ["non-string status", { title: "a", status: 3 }],
    ["non-string category", { title: "a", category: 3 }],
  ])("rejects %s", async (_n, body) => {
    expect((await call("POST", body)).status).toBe(400);
    expect(m.userStory.create).not.toHaveBeenCalled();
  });

  it("rejects a blank title", async () => {
    const res = await call("POST", { title: "  " });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Title is required" });
  });

  it("rejects an unknown status, priority, or date", async () => {
    expect(await (await call("POST", { title: "a", status: "Nope" })).json()).toEqual({
      error: "Invalid status",
    });
    expect(await (await call("POST", { title: "a", priority: "Urgent" })).json()).toEqual({
      error: "Invalid priority",
    });
    expect(await (await call("POST", { title: "a", startsAt: "zzz" })).json()).toEqual({
      error: "Invalid startsAt",
    });
    expect(await (await call("POST", { title: "a", endsAt: "zzz" })).json()).toEqual({
      error: "Invalid endsAt",
    });
    expect(m.userStory.create).not.toHaveBeenCalled();
  });
});

describe("create", () => {
  it("defaults status to Todo, appends at position 0 in an empty epic, nulls blanks", async () => {
    const res = await call("POST", { title: " Login " });
    expect(await res.json()).toEqual({ id: "new-story" });
    expect(m.userStory.create).toHaveBeenCalledWith({
      data: {
        epicId: EPIC_ID,
        title: "Login",
        notes: null,
        status: "Todo",
        position: 0,
        startsAt: null,
        endsAt: null,
        successMetric: null,
        acceptanceCriteria: null,
        priority: null,
        category: null,
      },
      select: { id: true },
    });
  });

  it("appends after the current max position", async () => {
    m.userStory.findFirst.mockResolvedValue({ position: 4 });
    await call("POST", { title: "a" });
    expect(m.userStory.findFirst).toHaveBeenCalledWith({
      where: { epicId: EPIC_ID },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    expect(m.userStory.create.mock.calls[0][0].data.position).toBe(5);
  });

  it("stores trimmed text, priority, status and UTC-midnight dates", async () => {
    await call("POST", {
      title: "a",
      notes: " n ",
      status: "InProgress",
      priority: "Should",
      category: " UX ",
      successMetric: " m ",
      acceptanceCriteria: " c ",
      startsAt: "2026-11-03T22:00:00Z",
      endsAt: "2026-11-10",
    });
    expect(m.userStory.create.mock.calls[0][0].data).toEqual({
      epicId: EPIC_ID,
      title: "a",
      notes: "n",
      status: "InProgress",
      position: 0,
      startsAt: new Date("2026-11-03T00:00:00.000Z"),
      endsAt: new Date("2026-11-10T00:00:00.000Z"),
      successMetric: "m",
      acceptanceCriteria: "c",
      priority: "Should",
      category: "UX",
    });
  });

  it("treats an empty-string priority as none", async () => {
    await call("POST", { title: "a", priority: "" });
    expect(m.userStory.create.mock.calls[0][0].data.priority).toBeNull();
  });
});
