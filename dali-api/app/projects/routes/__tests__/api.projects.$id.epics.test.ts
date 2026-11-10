import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));

import { requireProjectEditAccess } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { action } from "~/projects/routes/api.projects.$id.epics";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

function post(body: unknown, method = "POST", raw?: string) {
  const request = new Request("http://localhost/api/projects/p1/epics", {
    method,
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
  return action({ request, params: { id: "p1" } } as any) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as any);
  db.project.findUnique.mockResolvedValue({ id: "p1" });
  db.epic.findFirst.mockResolvedValue(null);
  db.epic.create.mockResolvedValue({ id: "e1" });
});

describe("POST /api/projects/:id/epics", () => {
  it("returns the gate response without touching the database when access is denied", async () => {
    const denied = new Response("no", { status: 403 });
    vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: false, response: denied } as any);
    expect(await post({ title: "x" })).toBe(denied);
    expect(vi.mocked(requireProjectEditAccess)).toHaveBeenCalledWith(expect.any(Request), "p1");
    expect(db.epic.create).not.toHaveBeenCalled();
  });

  it("rejects non-POST methods", async () => {
    expect((await post(undefined, "DELETE", "")).status).toBe(405);
  });

  it("rejects malformed JSON and non-object bodies", async () => {
    expect((await post(null, "POST", "{bad")).status).toBe(400);
    expect((await post(["x"])).status).toBe(400);
    expect((await post({ title: 5 })).status).toBe(400);
  });

  it("requires a non-blank title", async () => {
    const res = await post({ title: "   " });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Title is required" });
  });

  it("rejects an unknown status", async () => {
    const res = await post({ title: "E", status: "Archived" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid status" });
  });

  it("rejects an unparseable date", async () => {
    expect((await post({ title: "E", startsAt: "not-a-date" })).status).toBe(400);
    expect((await post({ title: "E", endsAt: "nope" })).status).toBe(400);
  });

  it("rejects an end date at or before the start date", async () => {
    const same = await post({ title: "E", startsAt: "2026-04-01T00:00:00Z", endsAt: "2026-04-01T00:00:00Z" });
    expect(same.status).toBe(400);
    const before = await post({ title: "E", startsAt: "2026-04-02T00:00:00Z", endsAt: "2026-04-01T00:00:00Z" });
    expect(before.status).toBe(400);
    expect(db.epic.create).not.toHaveBeenCalled();
  });

  it("404s when the project does not exist", async () => {
    db.project.findUnique.mockResolvedValue(null);
    expect((await post({ title: "E" })).status).toBe(404);
    expect(db.epic.create).not.toHaveBeenCalled();
  });

  it("creates an Open epic at position 0 on an empty project with trimmed title and null dates", async () => {
    const res = await post({ title: "  Launch  " });
    expect(await res.json()).toEqual({ id: "e1" });
    expect(db.epic.create).toHaveBeenCalledWith({
      data: { projectId: "p1", title: "Launch", status: "Open", position: 0, startsAt: null, endsAt: null },
      select: { id: true },
    });
  });

  it("appends after the project's highest epic position", async () => {
    db.epic.findFirst.mockResolvedValue({ position: 4 });
    await post({ title: "E" });
    expect(db.epic.findFirst).toHaveBeenCalledWith({
      where: { projectId: "p1" },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    expect(db.epic.create.mock.calls[0][0].data.position).toBe(5);
  });

  it("stores the given status and parsed dates", async () => {
    await post({ title: "E", status: "InProgress", startsAt: "2026-04-01T00:00:00Z", endsAt: "2026-05-01T00:00:00Z" });
    expect(db.epic.create.mock.calls[0][0].data).toMatchObject({
      status: "InProgress",
      startsAt: new Date("2026-04-01T00:00:00Z"),
      endsAt: new Date("2026-05-01T00:00:00Z"),
    });
  });

  it("accepts a single date without the other", async () => {
    await post({ title: "E", endsAt: "2026-05-01T00:00:00Z", startsAt: null });
    expect(db.epic.create.mock.calls[0][0].data).toMatchObject({ startsAt: null, endsAt: new Date("2026-05-01T00:00:00Z") });
  });
});
