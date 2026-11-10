import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));

import { requireProjectEditAccess } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { action } from "~/projects/routes/api.stories.$id";

const STORY_ID = "story-1";
const PROJECT_ID = "proj-1";

const m = prisma as any;

function call(method: string, body?: unknown, rawBody?: string) {
  const request = new Request(`http://localhost/api/stories/${STORY_ID}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(rawBody !== undefined
      ? { body: rawBody }
      : body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),
  });
  return action({ request, params: { id: STORY_ID } } as any) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: true } as any);
  m.userStory = {
    findUnique: vi.fn().mockResolvedValue({ id: STORY_ID, epic: { projectId: PROJECT_ID } }),
    update: vi.fn().mockReturnValue("story-update-op"),
    delete: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
  };
  m.userStoryDependency = {
    deleteMany: vi.fn().mockReturnValue("dep-clear-op"),
    create: vi.fn((args: any) => `dep-create-${args.data.dependsOnStoryId}`),
  };
  m.$transaction = vi.fn().mockResolvedValue([]);
});

describe("access", () => {
  it("rejects methods other than POST and DELETE with 405 before touching the db", async () => {
    const res = await call("GET");
    expect(res.status).toBe(405);
    expect(m.userStory.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown story", async () => {
    m.userStory.findUnique.mockResolvedValue(null);
    const res = await call("DELETE");
    expect(res.status).toBe(404);
    expect(requireProjectEditAccess).not.toHaveBeenCalled();
  });

  it("checks edit access against the project that owns the story's epic", async () => {
    await call("DELETE");
    expect(requireProjectEditAccess).toHaveBeenCalledWith(expect.any(Request), PROJECT_ID);
  });

  it("returns the gate's response and writes nothing when access is denied", async () => {
    vi.mocked(requireProjectEditAccess).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    } as any);
    const del = await call("DELETE");
    const post = await call("POST", { title: "x" });
    expect(del.status).toBe(403);
    expect(post.status).toBe(403);
    expect(m.userStory.delete).not.toHaveBeenCalled();
    expect(m.$transaction).not.toHaveBeenCalled();
  });
});

describe("DELETE", () => {
  it("deletes the story", async () => {
    const res = await call("DELETE");
    expect(res.status).toBe(200);
    expect(m.userStory.delete).toHaveBeenCalledWith({ where: { id: STORY_ID } });
  });
});

describe("POST validation", () => {
  it("rejects malformed JSON", async () => {
    expect((await call("POST", undefined, "{nope")).status).toBe(400);
  });

  it.each([
    ["non-string title", { title: 5 }],
    ["non-string status", { status: 1 }],
    ["non-string notes", { notes: 4 }],
    ["non-string category", { category: 4 }],
    ["non-array dependsOn", { dependsOn: "a" }],
    ["non-string dependsOn entries", { dependsOn: [1] }],
  ])("rejects %s", async (_n, body) => {
    const res = await call("POST", body);
    expect(res.status).toBe(400);
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a blank title", async () => {
    const res = await call("POST", { title: "   " });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Title is required" });
  });

  it("rejects an unknown status", async () => {
    const res = await call("POST", { status: "Blocked" });
    expect(await res.json()).toEqual({ error: "Invalid status" });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown priority", async () => {
    const res = await call("POST", { priority: "Urgent" });
    expect(await res.json()).toEqual({ error: "Invalid priority" });
  });

  it("rejects an unparseable date", async () => {
    const res = await call("POST", { startsAt: "garbage" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid startsAt" });
    const res2 = await call("POST", { endsAt: "garbage" });
    expect(await res2.json()).toEqual({ error: "Invalid endsAt" });
  });
});

describe("POST update data", () => {
  it("only sets the fields that were sent", async () => {
    await call("POST", { status: "Done" });
    expect(m.userStory.update).toHaveBeenCalledWith({
      where: { id: STORY_ID },
      data: { status: "Done" },
    });
  });

  it("trims text and turns blank optional text into null", async () => {
    await call("POST", {
      title: "  Ship it ",
      notes: "   ",
      successMetric: "  80% ",
      acceptanceCriteria: "",
      category: null,
    });
    expect(m.userStory.update).toHaveBeenCalledWith({
      where: { id: STORY_ID },
      data: {
        title: "Ship it",
        notes: null,
        successMetric: "80%",
        acceptanceCriteria: null,
        category: null,
      },
    });
  });

  it("accepts a valid priority and clears it with null or empty string", async () => {
    await call("POST", { priority: "Must" });
    expect(m.userStory.update.mock.calls[0][0].data).toEqual({ priority: "Must" });
    await call("POST", { priority: null });
    expect(m.userStory.update.mock.calls[1][0].data).toEqual({ priority: null });
    await call("POST", { priority: "" });
    expect(m.userStory.update.mock.calls[2][0].data).toEqual({ priority: null });
  });

  it("stores dates at UTC midnight and clears them with null or empty string", async () => {
    await call("POST", { startsAt: "2026-11-03T15:30:00Z", endsAt: null });
    expect(m.userStory.update.mock.calls[0][0].data).toEqual({
      startsAt: new Date("2026-11-03T00:00:00.000Z"),
      endsAt: null,
    });
    await call("POST", { startsAt: "" });
    expect(m.userStory.update.mock.calls[1][0].data).toEqual({ startsAt: null });
  });

  it("runs the update in a transaction and does not touch dependencies when dependsOn is absent", async () => {
    const res = await call("POST", { title: "A" });
    expect(res.status).toBe(200);
    expect(m.$transaction).toHaveBeenCalledWith(["story-update-op"]);
    expect(m.userStoryDependency.deleteMany).not.toHaveBeenCalled();
  });
});

describe("POST dependsOn", () => {
  it("replaces dependencies wholesale, deduping and dropping self-references", async () => {
    m.userStory.count.mockResolvedValue(2);
    const res = await call("POST", { dependsOn: ["a", "b", "a", STORY_ID, ""] });
    expect(res.status).toBe(200);
    expect(m.userStory.count).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, epic: { projectId: PROJECT_ID } },
    });
    expect(m.userStoryDependency.deleteMany).toHaveBeenCalledWith({ where: { storyId: STORY_ID } });
    expect(m.$transaction).toHaveBeenCalledWith([
      "story-update-op",
      "dep-clear-op",
      "dep-create-a",
      "dep-create-b",
    ]);
  });

  it("rejects targets outside the project and writes nothing", async () => {
    m.userStory.count.mockResolvedValue(1);
    const res = await call("POST", { dependsOn: ["a", "other-project"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid dependency target" });
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("an empty list clears all dependencies without a validity lookup", async () => {
    await call("POST", { dependsOn: [] });
    expect(m.userStory.count).not.toHaveBeenCalled();
    expect(m.$transaction).toHaveBeenCalledWith(["story-update-op", "dep-clear-op"]);
  });
});
