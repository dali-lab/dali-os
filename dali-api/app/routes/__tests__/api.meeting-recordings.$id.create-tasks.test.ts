// POST /api/meeting-recordings/:id { action: "createTasks" } — action items
// into Tasks (specs/meeting-notes-model.md §4).

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({ isCore: vi.fn().mockResolvedValue(false) }));
vi.mock("~/lib/project-access", () => ({ canEditProject: vi.fn() }));
vi.mock("~/lib/transcription/chunks.server", () => ({ deletePrefix: vi.fn() }));
vi.mock("~/calendar/lib/meeting-recording.server", () => ({
  canReadRecording: vi.fn(),
  canRecordInto: vi.fn(),
  claimRecording: vi.fn(),
  documentTitle: vi.fn().mockResolvedValue("Standup notes"),
  finalizeEmpty: vi.fn(),
  finishRecording: vi.fn(),
  parseSpeakerMap: vi.fn(),
  requestStop: vi.fn(),
  resumeRecording: vi.fn(),
  setSpeakers: vi.fn(),
  startProcessing: vi.fn(),
  storedLines: vi.fn().mockReturnValue([]),
}));
vi.mock("~/projects/lib/task-create.server", () => {
  class TaskCreateError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "TaskCreateError";
      this.status = status;
    }
  }
  return { createTask: vi.fn(), TaskCreateError };
});


import { requireAuth } from "~/lib/auth";
import { canEditProject } from "~/lib/project-access";
import { prisma } from "~/lib/db.server";
import { canRecordInto } from "~/calendar/lib/meeting-recording.server";
import { createTask, TaskCreateError } from "~/projects/lib/task-create.server";
import { action } from "~/routes/api.meeting-recordings.$id";

function post(body: unknown): Request {
  return new Request("http://localhost/api/meeting-recordings/rec1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const run = (body: unknown) =>
  action({ request: post(body), params: { id: "rec1" }, context: {} } as never) as Promise<Response>;

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec1",
    userId: "u1",
    documentName: "doc:p1:body",
    notes: {
      plan: {
        blocks: [],
        actionItems: [
          { text: "Send the revised scope", ownerUserId: "u-ada", cites: [1203] },
          { text: "Follow up with partner", cites: [1300] },
        ],
      },
      verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
      snapshotAt: "2026-10-10T00:00:00.000Z",
      snapshot: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u2", email: "u2@dali.edu", firstName: "Ada", lastName: "Lovelace", type: "member" },
    sessionId: "s1",
  } as never);
  vi.mocked(canRecordInto).mockResolvedValue(true);
  vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(recording() as never);
  vi.mocked(prisma.meetingRecording.update).mockResolvedValue({} as never);
  vi.mocked(prisma.page.findUnique).mockResolvedValue({
    workspaceType: "Project",
    workspaceId: "proj1",
  } as never);
  vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);
  vi.mocked(createTask).mockResolvedValue({ id: "task1", status: "Todo", position: 0 });
  vi.mocked(canEditProject).mockResolvedValue(true);
});

const noProject = () =>
  vi.mocked(prisma.page.findUnique).mockResolvedValue({ workspaceType: "Lab", workspaceId: null } as never);

describe('POST /api/meeting-recordings/:id { action: "createTasks" }', () => {
  it("requires edit access to the note", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(false);
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope" }] });
    expect(res.status).toBe(403);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("requires a project on the item when the note has none", async () => {
    noProject();
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope" }] });
    expect(res.status).toBe(400);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("files the task on the item's project when the note has none", async () => {
    noProject();
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope", projectId: "proj9" }] });
    expect(res.status).toBe(200);
    expect(canEditProject).toHaveBeenCalledWith("u2", "proj9");
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: "proj9" }));
    expect((await res.json()).created).toEqual([{ index: 0, taskId: "task1", projectId: "proj9" }]);
  });

  it("refuses an item's project the caller cannot add tasks to, creating nothing", async () => {
    noProject();
    vi.mocked(canEditProject).mockResolvedValue(false);
    const res = await run({
      action: "createTasks",
      items: [
        { index: 0, title: "Send the revised scope", projectId: "proj9" },
        { index: 1, title: "Follow up with partner", projectId: "proj9" },
      ],
    });
    expect(res.status).toBe(403);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("accepts an item project equal to the note's project", async () => {
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope", projectId: "proj1" }] });
    expect(res.status).toBe(200);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: "proj1" }));
  });

  it("rejects an item project that differs from the note's project", async () => {
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope", projectId: "proj9" }] });
    expect(res.status).toBe(400);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("passes the status through to the task", async () => {
    const res = await run({
      action: "createTasks",
      items: [{ index: 0, title: "Send the revised scope", status: "InProgress", dueAt: "2026-10-17T00:00:00.000Z" }],
    });
    expect(res.status).toBe(200);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ status: "InProgress" }));
  });

  it("allows Backlog without a due date", async () => {
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope", status: "Backlog" }] });
    expect(res.status).toBe(200);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ status: "Backlog" }));
  });

  it("requires a due date outside Backlog, creating nothing", async () => {
    const res = await run({
      action: "createTasks",
      items: [
        { index: 1, title: "Follow up with partner", status: "Backlog" },
        { index: 0, title: "Send the revised scope", status: "Todo" },
      ],
    });
    expect(res.status).toBe(400);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("rejects an unknown status", async () => {
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope", status: "Nope" }] });
    expect(res.status).toBe(400);
  });

  it("creates a task for each checked item, with a description linking the cited transcript moment", async () => {
    const res = await run({
      action: "createTasks",
      items: [{ index: 0, title: "Send the revised scope", assigneeId: "u-ada", dueAt: "2026-10-17T00:00:00.000Z" }],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toEqual([{ index: 0, taskId: "task1", projectId: "proj1" }]);
    expect(createTask).toHaveBeenCalledWith({
      projectId: "proj1",
      actorId: "u2",
      status: undefined,
      title: "Send the revised scope",
      description: 'Action item from "Standup notes" at 20:03.\nhttp://localhost/documents/p1?transcript=rec1&at=1203',
      assigneeUserIds: ["u-ada"],
      dueAt: new Date("2026-10-17T00:00:00.000Z"),
      sourceRecordingId: "rec1",
    });
    // The action item's taskId is written back for the dedup guard.
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith({
      where: { id: "rec1" },
      data: {
        notes: expect.objectContaining({
          plan: expect.objectContaining({
            actionItems: [
              expect.objectContaining({ taskId: "task1" }),
              expect.objectContaining({ text: "Follow up with partner" }),
            ],
          }),
        }),
      },
    });
  });

  it("refuses to create a second task for an index that already has one (dedup)", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(
      recording({
        notes: {
          plan: {
            blocks: [],
            actionItems: [{ text: "Send the revised scope", cites: [1203], taskId: "existing-task" }],
          },
          verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
          snapshotAt: "2026-10-10T00:00:00.000Z",
          snapshot: [],
        },
      }) as never,
    );
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope" }] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toEqual([]);
    expect(createTask).not.toHaveBeenCalled();
    expect(prisma.meetingRecording.update).not.toHaveBeenCalled();
  });

  it("dedups against an existing task from this recording whose title matches, even at a different index (a re-run renumbered items)", async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValue([{ id: "task-old", title: "Send the revised scope", projectId: "proj1" }] as never);
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope" }] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toEqual([{ index: 0, taskId: "task-old", projectId: "proj1" }]);
    expect(createTask).not.toHaveBeenCalled();
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith({
      where: { id: "rec1" },
      data: {
        notes: expect.objectContaining({
          plan: expect.objectContaining({
            actionItems: [
              expect.objectContaining({ taskId: "task-old" }),
              expect.not.objectContaining({ taskId: expect.anything() }),
            ],
          }),
        }),
      },
    });
  });

  it("refuses a note project the caller cannot edit, creating nothing", async () => {
    vi.mocked(canEditProject).mockResolvedValue(false);
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope" }] });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden", created: [] });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("maps a TaskCreateError to its status and message", async () => {
    vi.mocked(createTask).mockRejectedValue(new TaskCreateError("Project not found", 404));
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope" }] });
    expect(res.status).toBe(404);
  });

  it("keeps the task ids already created when a later item fails, so a retry can't duplicate them", async () => {
    vi.mocked(createTask)
      .mockResolvedValueOnce({ id: "task1" } as never);
    const res = await run({
      action: "createTasks",
      items: [
        { index: 0, title: "Send the revised scope" },
        { index: 1, title: "Follow up with partner", dueAt: "not-a-date" },
      ],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid dueAt", created: [{ index: 0, taskId: "task1", projectId: "proj1" }] });
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith({
      where: { id: "rec1" },
      data: {
        notes: expect.objectContaining({
          plan: expect.objectContaining({
            actionItems: [
              expect.objectContaining({ taskId: "task1" }),
              expect.not.objectContaining({ taskId: expect.anything() }),
            ],
          }),
        }),
      },
    });
  });

  it("passes no status or due date for an undated item so the service files it in Backlog", async () => {
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope" }] });
    expect(res.status).toBe(200);
    const args = vi.mocked(createTask).mock.calls[0][0];
    expect(args.status).toBeUndefined();
    expect(args.dueAt).toBeUndefined();
    expect(await res.json()).toEqual({ created: [{ index: 0, taskId: "task1", projectId: "proj1" }] });
  });

  it("skips an out-of-range index without creating anything", async () => {
    const res = await run({ action: "createTasks", items: [{ index: 9, title: "Ghost item" }] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toEqual([]);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    const res = await run({ action: "createTasks", items: [{ title: "No index" }] });
    expect(res.status).toBe(400);
  });
});
