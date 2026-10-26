// POST /api/meeting-recordings/:id — the enhance lock (specs/meeting-notes-
// model.md §2: refuses the apply when someone else's `notes` write landed
// after this client's own preview snapshot) and the { action: "stop" }
// permission rules (an editor, not just the owner, may stop or end a
// recording whose owner went silent).

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ isCore: vi.fn().mockResolvedValue(false) }));
vi.mock("~/lib/transcription/chunks.server", () => ({ deletePrefix: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/meeting-recording.server", () => ({
  canReadRecording: vi.fn(),
  canRecordInto: vi.fn(),
  claimRecording: vi.fn(),
  finalizeEmpty: vi.fn(),
  finishRecording: vi.fn(),
  parseSpeakerMap: vi.fn(),
  requestStop: vi.fn(),
  resolveSpeakerNames: vi.fn().mockResolvedValue({}),
  resumeRecording: vi.fn(),
  setSpeakers: vi.fn(),
  startProcessing: vi.fn(),
  storedLines: vi.fn().mockReturnValue([]),
}));

import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { isCore } from "~/lib/roles";
import { deletePrefix } from "~/lib/transcription/chunks.server";
import { prisma } from "~/lib/db";
import {
  canReadRecording,
  canRecordInto,
  finalizeEmpty,
  requestStop,
  startProcessing,
} from "~/lib/meeting-recording.server";
import { action, loader } from "~/routes/api.meeting-recordings.$id";

function post(body: unknown): Request {
  return new Request("http://localhost/api/meeting-recordings/rec1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const run = (body: unknown) =>
  action({ request: post(body), params: { id: "rec1" }, context: {} } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u2", email: "u2@dali.edu", firstName: "Ada", lastName: "Lovelace", type: "member" },
    sessionId: "s1",
  } as never);
  vi.mocked(canRecordInto).mockResolvedValue(true);
  vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
    id: "rec1",
    userId: "u1",
    documentName: "doc:p1:body",
    notes: null,
  } as never);
  vi.mocked(prisma.meetingRecording.update).mockResolvedValue({} as never);
});

describe('POST /api/meeting-recordings/:id { action: "enhanced" }', () => {
  it("requires snapshotAt", async () => {
    const res = await run({ action: "enhanced" });
    expect(res.status).toBe(400);
  });

  it("requires edit access to the note", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(false);
    const res = await run({ action: "enhanced", snapshotAt: "2026-10-10T00:00:00.000Z" });
    expect(res.status).toBe(403);
  });

  it("sets enhancedAt/enhancedBy when no later notes write exists", async () => {
    const res = await run({ action: "enhanced", snapshotAt: "2026-10-10T00:00:00.000Z" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enhancedBy).toBe("Ada Lovelace");
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith({
      where: { id: "rec1" },
      data: { enhancedAt: expect.any(Date), enhancedBy: "Ada Lovelace" },
    });
  });

  it("accepts a snapshotAt equal to the stored notes snapshot", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
      id: "rec1",
      userId: "u1",
      documentName: "doc:p1:body",
      notes: { snapshotAt: "2026-10-10T00:00:00.000Z" },
    } as never);
    const res = await run({ action: "enhanced", snapshotAt: "2026-10-10T00:00:00.000Z" });
    expect(res.status).toBe(200);
  });

  it("409s when someone else's notes write landed after this client's snapshot", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
      id: "rec1",
      userId: "u1",
      documentName: "doc:p1:body",
      notes: { snapshotAt: "2026-10-10T00:05:00.000Z" },
    } as never);
    const res = await run({ action: "enhanced", snapshotAt: "2026-10-10T00:00:00.000Z" });
    expect(res.status).toBe(409);
    expect(prisma.meetingRecording.update).not.toHaveBeenCalled();
  });

  it("stores priorBlocks onto notes when the client sends them", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
      id: "rec1",
      userId: "u1",
      documentName: "doc:p1:body",
      notes: { snapshotAt: "2026-10-10T00:00:00.000Z", plan: { blocks: [], actionItems: [] } },
    } as never);
    const priorBlocks = { b1: { id: "b1", type: "paragraph", props: {}, content: [], children: [] } };
    const res = await run({ action: "enhanced", snapshotAt: "2026-10-10T00:00:00.000Z", priorBlocks });
    expect(res.status).toBe(200);
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith({
      where: { id: "rec1" },
      data: {
        enhancedAt: expect.any(Date),
        enhancedBy: "Ada Lovelace",
        notes: {
          snapshotAt: "2026-10-10T00:00:00.000Z",
          plan: { blocks: [], actionItems: [] },
          priorBlocks,
        },
      },
    });
  });

  it("rejects a priorBlocks value that isn't an object map", async () => {
    const res = await run({
      action: "enhanced",
      snapshotAt: "2026-10-10T00:00:00.000Z",
      priorBlocks: "nope",
    });
    expect(res.status).toBe(400);
    expect(prisma.meetingRecording.update).not.toHaveBeenCalled();
  });

  it("413s a priorBlocks payload over the size cap", async () => {
    const priorBlocks = { b1: { text: "x".repeat(600_000) } };
    const res = await run({ action: "enhanced", snapshotAt: "2026-10-10T00:00:00.000Z", priorBlocks });
    expect(res.status).toBe(413);
    expect(prisma.meetingRecording.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/meeting-recordings/:id { action: "reviewed" }', () => {
  it("requires edit access to the note", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(false);
    const res = await run({ action: "reviewed" });
    expect(res.status).toBe(403);
  });

  it("stamps notes.reviewedAt and returns it", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
      id: "rec1",
      userId: "u1",
      documentName: "doc:p1:body",
      notes: { snapshotAt: "2026-10-10T00:00:00.000Z", plan: { blocks: [], actionItems: [] } },
    } as never);
    const res = await run({ action: "reviewed" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.reviewedAt).toBe("string");
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith({
      where: { id: "rec1" },
      data: {
        notes: {
          snapshotAt: "2026-10-10T00:00:00.000Z",
          plan: { blocks: [], actionItems: [] },
          reviewedAt: json.reviewedAt,
        },
      },
    });
  });

  it("works even when the recording has no notes yet", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
      id: "rec1",
      userId: "u1",
      documentName: "doc:p1:body",
      notes: null,
    } as never);
    const res = await run({ action: "reviewed" });
    expect(res.status).toBe(200);
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith({
      where: { id: "rec1" },
      data: { notes: { reviewedAt: expect.any(String) } },
    });
  });

  it("any editor (not just the owner) may mark reviewed", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { sub: "u2", email: "u2@dali.edu", firstName: "Grace", lastName: "Hopper", type: "member" },
      sessionId: "s2",
    } as never);
    const res = await run({ action: "reviewed" });
    expect(res.status).toBe(200);
  });
});

// POST /api/meeting-recordings/:id { action: "stop" } — the incident fix: a
// note editor (not just the owner) can stop a recording whose owner went
// silent, and can transcribe it once the owner's device looks done uploading.
describe('POST /api/meeting-recordings/:id { action: "stop" }', () => {
  function recording(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "rec1",
      userId: "u1",
      documentName: "doc:p1:body",
      notes: null,
      status: "Recording",
      channels: ["mic"],
      stopRequested: false,
      finalizedAt: null,
      lastChunkAt: new Date("2026-10-10T00:00:00.000Z"),
      ...overrides,
    };
  }

  it("lets the owner stop (non-final) without checking canRecordInto", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { sub: "u1", email: "u1@dali.edu", firstName: "Owner", lastName: "User", type: "member" },
      sessionId: "s1",
    } as never);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(recording() as never);
    const res = await run({ action: "stop" });
    expect(res.status).toBe(200);
    expect(canRecordInto).not.toHaveBeenCalled();
    expect(requestStop).toHaveBeenCalled();
  });

  it("lets an editor who isn't the owner stop (non-final)", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(true);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(recording() as never);
    const res = await run({ action: "stop" });
    expect(res.status).toBe(200);
    expect(canRecordInto).toHaveBeenCalledWith("u2", "doc:p1:body");
    expect(requestStop).toHaveBeenCalled();
  });

  it("refuses a non-editor, non-owner stop", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(false);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(recording() as never);
    const res = await run({ action: "stop" });
    expect(res.status).toBe(403);
    expect(requestStop).not.toHaveBeenCalled();
  });

  it("refuses an editor's final stop while the owner's device looks live (recent chunk, no stopRequested)", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(true);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(
      recording({ lastChunkAt: new Date(Date.now() - 30_000) }) as never,
    );
    const res = await run({ action: "stop", final: true });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("ownerOnly");
    expect(requestStop).not.toHaveBeenCalled();
    expect(startProcessing).not.toHaveBeenCalled();
    expect(finalizeEmpty).not.toHaveBeenCalled();
  });

  it("allows an editor's final stop once the owner's last chunk is stale", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(true);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(
      recording({ lastChunkAt: new Date(Date.now() - 3 * 60_000) }) as never,
    );
    const res = await run({ action: "stop", final: true });
    expect(res.status).toBe(200);
    expect(requestStop).toHaveBeenCalled();
    expect(startProcessing).toHaveBeenCalled();
  });

  it("allows an editor's final stop when the owner never uploaded a chunk", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(true);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(
      recording({ lastChunkAt: null, channels: [] }) as never,
    );
    const res = await run({ action: "stop", final: true });
    expect(res.status).toBe(200);
    expect(finalizeEmpty).toHaveBeenCalled();
  });

  it("allows an editor's final stop once stopRequested is already set, even with a fresh chunk", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(true);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(
      recording({ stopRequested: true, lastChunkAt: new Date() }) as never,
    );
    const res = await run({ action: "stop", final: true });
    expect(res.status).toBe(200);
    expect(startProcessing).toHaveBeenCalled();
  });

  it("lets the owner's own final stop through regardless of staleness", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { sub: "u1", email: "u1@dali.edu", firstName: "Owner", lastName: "User", type: "member" },
      sessionId: "s1",
    } as never);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(
      recording({ lastChunkAt: new Date() }) as never,
    );
    const res = await run({ action: "stop", final: true });
    expect(res.status).toBe(200);
    expect(startProcessing).toHaveBeenCalled();
  });

  it("409s when the recording can't be processed again (already finalized)", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(true);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(
      recording({ finalizedAt: new Date() }) as never,
    );
    const res = await run({ action: "stop" });
    expect(res.status).toBe(409);
  });

  it("logs recording.stop with who stopped it and whether it was final", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(true);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(
      recording({ lastChunkAt: new Date(Date.now() - 3 * 60_000) }) as never,
    );
    await run({ action: "stop", final: true });
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "recording.stop",
        userId: "u2",
        targetId: "rec1",
        metadata: { final: true, byOwner: false },
      }),
    );
  });

  it("logs the owner's non-final stop as byOwner", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { sub: "u1", email: "u1@dali.edu", firstName: "Owner", lastName: "User", type: "member" },
      sessionId: "s1",
    } as never);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(recording() as never);
    await run({ action: "stop" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", metadata: { final: false, byOwner: true } }),
    );
  });

  it("does not log a refused stop", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(false);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(recording() as never);
    await run({ action: "stop" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("does not log an editor's final stop refused as ownerOnly", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(true);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(
      recording({ lastChunkAt: new Date(Date.now() - 30_000) }) as never,
    );
    await run({ action: "stop", final: true });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("does not log a stop on an already finalized recording", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(
      recording({ finalizedAt: new Date() }) as never,
    );
    await run({ action: "stop" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/meeting-recordings/:id", () => {
  const del = () =>
    action({
      request: new Request("http://localhost/api/meeting-recordings/rec1", { method: "DELETE" }),
      params: { id: "rec1" },
      context: {},
    } as never) as Promise<Response>;

  beforeEach(() => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
      id: "rec1",
      userId: "u1",
      documentName: "doc:p1:body",
      status: "Recording",
    } as never);
    vi.mocked(prisma.meetingRecording.delete).mockResolvedValue({} as never);
  });

  it("lets Core discard someone else's recording and logs the owner", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const res = await del();
    expect(res.status).toBe(200);
    expect(deletePrefix).toHaveBeenCalledWith("rec1");
    expect(prisma.meetingRecording.delete).toHaveBeenCalledWith({ where: { id: "rec1" } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "recording.discard",
        userId: "u2",
        targetId: "rec1",
        metadata: { ownerId: "u1", documentName: "doc:p1:body", status: "Recording" },
      }),
    );
  });

  it("lets the owner discard their own recording", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { sub: "u1", email: "u1@dali.edu", type: "member" },
      sessionId: "s1",
    } as never);
    const res = await del();
    expect(res.status).toBe(200);
    expect(isCore).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recording.discard", userId: "u1" }),
    );
  });

  it("refuses a non-owner who isn't Core and logs nothing", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await del();
    expect(res.status).toBe(403);
    expect(prisma.meetingRecording.delete).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("GET /api/meeting-recordings/:id sessionSeconds", () => {
  const NOW = new Date("2026-10-26T15:10:00Z");

  async function get(row: Record<string, unknown>, access: "owner" | "viewer") {
    vi.mocked(canReadRecording).mockResolvedValue(access as never);
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
      id: "rec1",
      userId: "u1",
      documentName: "doc:p1:body",
      notes: null,
      speakers: {},
      recordedSeconds: 300,
      ...row,
    } as never);
    vi.useFakeTimers({ now: NOW });
    try {
      const res = (await loader({
        request: new Request("http://localhost/api/meeting-recordings/rec1"),
        params: { id: "rec1" },
        context: {},
      } as never)) as Response;
      return (await res.json()) as { sessionSeconds: number | null; recordedSeconds: number };
    } finally {
      vi.useRealTimers();
    }
  }

  it.each(["owner", "viewer"] as const)("gives the %s how long the live session has run", async (access) => {
    const json = await get({ status: "Recording", sessionStartedAt: new Date("2026-10-26T15:00:00Z") }, access);
    expect(json.sessionSeconds).toBe(600);
    expect(json.recordedSeconds).toBe(300);
  });

  it.each(["Pending", "Stopped", "Processing", "Done"])("is null once the row is %s, even with a stale start", async (status) => {
    const json = await get({ status, sessionStartedAt: new Date("2026-10-26T15:00:00Z") }, "owner");
    expect(json.sessionSeconds).toBeNull();
  });

  it("is null for a Recording row from before session starts were stored", async () => {
    const json = await get({ status: "Recording", sessionStartedAt: null }, "owner");
    expect(json.sessionSeconds).toBeNull();
  });

  it("never goes negative when the start is ahead of the server clock", async () => {
    const json = await get({ status: "Recording", sessionStartedAt: new Date("2026-10-26T15:10:05Z") }, "owner");
    expect(json.sessionSeconds).toBe(0);
  });
});
