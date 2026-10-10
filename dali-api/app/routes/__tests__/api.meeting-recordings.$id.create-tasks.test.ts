// POST /api/meeting-recordings/:id { action: "createTasks" } — action items
// into Tasks (specs/meeting-notes-model.md §4).

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ isCore: vi.fn().mockResolvedValue(false) }));
vi.mock("~/lib/transcription/chunks.server", () => ({ deletePrefix: vi.fn() }));
vi.mock("~/lib/meeting-recording.server", () => ({
  canReadRecording: vi.fn(),
  canRecordInto: vi.fn(),
  claimRecording: vi.fn(),
  finalizeEmpty: vi.fn(),
  finishRecording: vi.fn(),
  parseSpeakerMap: vi.fn(),
  requestStop: vi.fn(),
  resumeRecording: vi.fn(),
  setSpeakers: vi.fn(),
  startProcessing: vi.fn(),
  storedLines: vi.fn().mockReturnValue([]),
}));
vi.mock("~/mcp/tools/create-task", () => {
  class CreateTaskError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "CreateTaskError";
      this.status = status;
    }
  }
  return { runCreateTask: vi.fn(), CreateTaskError };
});

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canRecordInto } from "~/lib/meeting-recording.server";
import { runCreateTask, CreateTaskError } from "~/mcp/tools/create-task";
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
  vi.mocked(runCreateTask).mockResolvedValue({ id: "task1", status: "Todo", position: 0 });
});

describe('POST /api/meeting-recordings/:id { action: "createTasks" }', () => {
  it("requires edit access to the note", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(false);
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope" }] });
    expect(res.status).toBe(403);
    expect(runCreateTask).not.toHaveBeenCalled();
  });

  it("requires the note to belong to a project", async () => {
    vi.mocked(prisma.page.findUnique).mockResolvedValue({ workspaceType: "Lab", workspaceId: null } as never);
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope" }] });
    expect(res.status).toBe(400);
    expect(runCreateTask).not.toHaveBeenCalled();
  });

  it("creates a task for each checked item, with a description linking the cited transcript moment", async () => {
    const res = await run({
      action: "createTasks",
      items: [{ index: 0, title: "Send the revised scope", assigneeId: "u-ada", dueAt: "2026-10-17T00:00:00.000Z" }],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toEqual([{ index: 0, taskId: "task1" }]);
    expect(runCreateTask).toHaveBeenCalledWith("u2", {
      projectId: "proj1",
      title: "Send the revised scope",
      description: "/documents/p1?transcript=rec1&at=1203",
      assigneeUserIds: ["u-ada"],
      dueAt: "2026-10-17T00:00:00.000Z",
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
    expect(runCreateTask).not.toHaveBeenCalled();
    expect(prisma.meetingRecording.update).not.toHaveBeenCalled();
  });

  it("maps a CreateTaskError (e.g. no task-create rights on the project) to its status", async () => {
    vi.mocked(runCreateTask).mockRejectedValue(new CreateTaskError("Forbidden", 403));
    const res = await run({ action: "createTasks", items: [{ index: 0, title: "Send the revised scope" }] });
    expect(res.status).toBe(403);
  });

  it("keeps the task ids already created when a later item fails, so a retry can't duplicate them", async () => {
    vi.mocked(runCreateTask)
      .mockResolvedValueOnce({ id: "task1" } as never)
      .mockRejectedValueOnce(new CreateTaskError("Invalid dueAt", 400));
    const res = await run({
      action: "createTasks",
      items: [
        { index: 0, title: "Send the revised scope" },
        { index: 1, title: "Follow up with partner", dueAt: "not-a-date" },
      ],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid dueAt", created: [{ index: 0, taskId: "task1" }] });
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

  it("skips an out-of-range index without creating anything", async () => {
    const res = await run({ action: "createTasks", items: [{ index: 9, title: "Ghost item" }] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toEqual([]);
    expect(runCreateTask).not.toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    const res = await run({ action: "createTasks", items: [{ title: "No index" }] });
    expect(res.status).toBe(400);
  });
});
