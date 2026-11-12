import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/projects/lib/github-task-sync", () => ({
  createIssueForTask: vi.fn(),
  normalizeRepo: vi.fn((s: string) => {
    const r = s.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "");
    return /^[^/\s]+\/[^/\s]+$/.test(r) ? r : null;
  }),
}));
vi.mock("~/projects/lib/task-position.server", () => ({ nextColumnPosition: vi.fn() }));

import { requireProjectEditAccess } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { createIssueForTask } from "~/projects/lib/github-task-sync";
import { nextColumnPosition } from "~/projects/lib/task-position.server";
import { action } from "~/projects/routes/api.projects.$id.tasks";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

function post(body: unknown, method = "POST", raw?: string) {
  const request = new Request("http://localhost/api/projects/p1/tasks", {
    method,
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
  return action({ request, params: { id: "p1" } } as any) as Promise<Response>;
}

const DUE = "2026-05-01T12:00:00Z";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as any);
  db.project.findUnique.mockResolvedValue({ id: "p1", repoUrls: ["https://github.com/example/repo.git"] });
  db.userStory.findUnique.mockResolvedValue(null);
  db.epic.findUnique.mockResolvedValue(null);
  db.task.create.mockResolvedValue({ id: "t1" });
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db));
  vi.mocked(nextColumnPosition).mockResolvedValue(7);
  vi.mocked(createIssueForTask).mockResolvedValue(undefined as never);
});

describe("POST /api/projects/:id/tasks — access and shape", () => {
  it("returns the gate response without creating when access is denied", async () => {
    const denied = new Response("no", { status: 403 });
    vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: false, response: denied } as any);
    expect(await post({ title: "T", dueAt: DUE })).toBe(denied);
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("rejects non-POST methods", async () => {
    expect((await post(undefined, "PUT", "")).status).toBe(405);
  });

  it("rejects malformed JSON and wrongly typed fields", async () => {
    expect((await post(null, "POST", "{bad")).status).toBe(400);
    expect((await post({ title: 3 })).status).toBe(400);
    expect((await post({ title: "T", epicId: 4 })).status).toBe(400);
    expect((await post({ title: "T", github: "x/y" })).status).toBe(400);
    expect((await post({ title: "T", github: { repo: 1 } })).status).toBe(400);
  });

  it("requires a non-blank title", async () => {
    const res = await post({ title: "  ", dueAt: DUE });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Title is required" });
  });

  it("rejects an unknown status and unparseable dates", async () => {
    expect((await post({ title: "T", status: "Nope", dueAt: DUE })).status).toBe(400);
    expect(await (await post({ title: "T", dueAt: "garbage" })).json()).toEqual({ error: "Invalid dueAt" });
    expect(await (await post({ title: "T", dueAt: DUE, startsAt: "garbage" })).json()).toEqual({ error: "Invalid startsAt" });
  });

  it("requires a deadline for anything outside Backlog", async () => {
    const res = await post({ title: "T" });
    expect(res.status).toBe(400);
    expect((await post({ title: "T", status: "InProgress", dueAt: "" })).status).toBe(400);
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("allows an undated task in Backlog", async () => {
    const res = await post({ title: "T", status: "Backlog" });
    expect(res.status).toBe(200);
    expect(db.task.create.mock.calls[0][0].data).toMatchObject({ status: "Backlog", dueAt: null, startsAt: null });
  });

  it("404s when the project does not exist", async () => {
    db.project.findUnique.mockResolvedValue(null);
    expect((await post({ title: "T", dueAt: DUE })).status).toBe(404);
  });
});

describe("POST /api/projects/:id/tasks — create", () => {
  it("creates a Todo task at the next column position, stamped with the creator", async () => {
    const res = await post({ title: "  Write docs ", description: "  Details  ", dueAt: DUE, startsAt: "2026-04-20T00:00:00Z" });
    expect(await res.json()).toEqual({ id: "t1" });
    expect(nextColumnPosition).toHaveBeenCalledWith("p1", "Todo");
    expect(db.task.create).toHaveBeenCalledWith({
      data: {
        projectId: "p1",
        title: "Write docs",
        description: "Details",
        status: "Todo",
        position: 7,
        epicId: null,
        storyId: null,
        dueAt: new Date(DUE),
        startsAt: new Date("2026-04-20T00:00:00Z"),
        createdById: "u1",
      },
      select: { id: true },
    });
  });

  it("stores a blank description as null", async () => {
    await post({ title: "T", description: "   ", dueAt: DUE });
    expect(db.task.create.mock.calls[0][0].data.description).toBeNull();
  });

  it("positions the task in the requested column", async () => {
    await post({ title: "T", status: "InProgress", dueAt: DUE });
    expect(nextColumnPosition).toHaveBeenCalledWith("p1", "InProgress");
  });
});

describe("POST /api/projects/:id/tasks — epic and story ownership", () => {
  it("rejects a story from another project", async () => {
    db.userStory.findUnique.mockResolvedValue({ epicId: "e9", epic: { projectId: "other" } });
    const res = await post({ title: "T", dueAt: DUE, storyId: "s1" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Story is not part of this project" });
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown story", async () => {
    expect((await post({ title: "T", dueAt: DUE, storyId: "ghost" })).status).toBe(400);
  });

  it("derives the epic from the story and ignores a conflicting epicId", async () => {
    db.userStory.findUnique.mockResolvedValue({ epicId: "e-of-story", epic: { projectId: "p1" } });
    await post({ title: "T", dueAt: DUE, storyId: "s1", epicId: "e-other" });
    expect(db.task.create.mock.calls[0][0].data).toMatchObject({ storyId: "s1", epicId: "e-of-story" });
    expect(db.epic.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an epic from another project and a missing epic", async () => {
    db.epic.findUnique.mockResolvedValue({ projectId: "other" });
    const res = await post({ title: "T", dueAt: DUE, epicId: "e1" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Epic is not part of this project" });
    db.epic.findUnique.mockResolvedValue(null);
    expect((await post({ title: "T", dueAt: DUE, epicId: "e1" })).status).toBe(400);
  });

  it("links a story-less task to a free-standing epic of this project", async () => {
    db.epic.findUnique.mockResolvedValue({ projectId: "p1" });
    await post({ title: "T", dueAt: DUE, epicId: "e1" });
    expect(db.task.create.mock.calls[0][0].data).toMatchObject({ epicId: "e1", storyId: null });
  });
});

describe("POST /api/projects/:id/tasks — GitHub mirror", () => {
  it("rejects a repo string that is not owner/repo", async () => {
    const res = await post({ title: "T", dueAt: DUE, github: { repo: "not a repo" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid GitHub repo" });
  });

  it("rejects a repo that is not one of the project's declared repos", async () => {
    const res = await post({ title: "T", dueAt: DUE, github: { repo: "someone/else" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That GitHub repo is not one of the project's repos" });
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("mirrors the task to the normalized repo when it matches a declared URL", async () => {
    await post({ title: "T", dueAt: DUE, github: { repo: "example/repo" } });
    expect(createIssueForTask).toHaveBeenCalledWith("t1", "example/repo");
  });

  it("does not mirror when github is absent", async () => {
    await post({ title: "T", dueAt: DUE });
    expect(createIssueForTask).not.toHaveBeenCalled();
  });

  it("still succeeds when the GitHub mirror fails", async () => {
    vi.mocked(createIssueForTask).mockRejectedValue(new Error("gh down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ title: "T", dueAt: DUE, github: { repo: "example/repo" } });
    expect(res.status).toBe(200);
    await Promise.resolve();
    spy.mockRestore();
  });
});
