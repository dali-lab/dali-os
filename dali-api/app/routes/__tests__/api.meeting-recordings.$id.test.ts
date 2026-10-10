// POST /api/meeting-recordings/:id { action: "enhanced" } — the enhance lock
// (specs/meeting-notes-model.md §2): refuses the apply when someone else's
// `notes` write landed after this client's own preview snapshot.

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

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canRecordInto } from "~/lib/meeting-recording.server";
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
});
