// enhanceMeetingNotes — specs/meeting-notes-model.md §2, §4, §6.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/calendar/lib/meeting-recording.server", () => ({
  canRecordInto: vi.fn(),
  storedLines: vi.fn().mockReturnValue([]),
  resolveSpeakerNames: vi.fn().mockResolvedValue({}),
}));
vi.mock("~/collab/server", () => ({ getCollabServer: vi.fn() }));
vi.mock("~/collab/persistence", () => ({ forceSnapshot: vi.fn() }));
vi.mock("~/collab/read", () => ({ readDocAsBlocks: vi.fn() }));
vi.mock("~/collab/write", () => ({ replaceCollabDocContent: vi.fn() }));
vi.mock("~/calendar/lib/meeting-notes-enhance.server", () => ({
  AI_BURST_MAX: 10,
  AI_BURST_WINDOW_MS: 60_000,
  generateAndVerifyEnhancePlan: vi.fn(),
  resolveMeetingEnhanceContext: vi.fn().mockResolvedValue({ roster: [], meetingTypeLabel: "Meeting", occurrenceDate: "2026-10-10" }),
}));
vi.mock("~/calendar/lib/meeting-notes-apply.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/calendar/lib/meeting-notes-apply.server")>()),
  applyEnhanceOpsToDocBlocks: vi.fn((_ops: unknown, blocks: unknown) => blocks),
  ensureTranscriptToggle: vi.fn((blocks: unknown) => blocks),
}));

import { prisma } from "~/lib/db.server";
import { canRecordInto, resolveSpeakerNames, storedLines } from "~/calendar/lib/meeting-recording.server";
import { applyEnhanceOpsToDocBlocks } from "~/calendar/lib/meeting-notes-apply.server";
import { getCollabServer } from "~/collab/server";
import { forceSnapshot } from "~/collab/persistence";
import { readDocAsBlocks } from "~/collab/read";
import { replaceCollabDocContent } from "~/collab/write";
import { generateAndVerifyEnhancePlan } from "~/calendar/lib/meeting-notes-enhance.server";
import { _resetForTests as resetRateLimits } from "~/lib/rate-limit";
import { ENHANCE_MARK_ADDED, ENHANCE_MARK_PRIOR } from "~/components/meeting-recorder/enhance-plan";
import { enhanceMeetingNotes } from "../enhance-meeting-notes.server";

const mockPrisma = prisma as unknown as {
  meetingRecording: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  page: { findUnique: ReturnType<typeof vi.fn> };
};

function ctxFor(userId: string) {
  return {
    user: { id: userId, daliEmail: `${userId}@dali.edu`, dartmouthEmail: null, netId: null, firstName: "Ada", lastName: "Lovelace" },
    scopes: ["mcp:write"],
    request: new Request("http://localhost/mcp"),
  } as never;
}

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec1",
    documentName: "doc:p1:body",
    scheduledMeetingId: null,
    occurrenceStart: null,
    createdAt: new Date("2026-10-10T00:00:00.000Z"),
    speakers: {},
    notes: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  vi.mocked(canRecordInto).mockResolvedValue(true);
  mockPrisma.meetingRecording.findUnique.mockResolvedValue(recording());
  mockPrisma.meetingRecording.update.mockResolvedValue({});
  mockPrisma.page.findUnique.mockResolvedValue({ seededFromPageId: null, seededTemplateHash: null });
  vi.mocked(readDocAsBlocks).mockResolvedValue([]);
  vi.mocked(getCollabServer).mockReturnValue({} as never);
});

describe("enhanceMeetingNotes", () => {
  it("denies a caller without edit access to the note", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(false);
    await expect(enhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1" })).rejects.toMatchObject({
      status: 403,
    });
    expect(generateAndVerifyEnhancePlan).not.toHaveBeenCalled();
  });

  it("returns 429 once the per-user burst budget is spent, before generating", async () => {
    vi.mocked(generateAndVerifyEnhancePlan).mockResolvedValue({
      ok: true,
      notes: { plan: { blocks: [], actionItems: [] }, verified: {}, snapshotAt: "t" },
    } as never);
    for (let i = 0; i < 10; i++) await enhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1" });
    await expect(enhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1" })).rejects.toMatchObject({
      status: 429,
    });
    expect(generateAndVerifyEnhancePlan).toHaveBeenCalledTimes(10);
  });

  it("404s when the recording doesn't exist", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(null);
    await expect(enhanceMeetingNotes(ctxFor("u1"), { recordingId: "missing" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("preview (apply omitted) returns the verified plan shape", async () => {
    vi.mocked(generateAndVerifyEnhancePlan).mockResolvedValue({
      ok: true,
      notes: {
        plan: { blocks: [{ id: "b1", op: "keep" }], actionItems: [] },
        verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
        snapshotAt: "2026-10-10T00:00:00.000Z",
        snapshot: [{ id: "b1", type: "paragraph", text: "hi" }],
      },
    } as never);

    const result = await enhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1" });

    expect(result).toEqual({
      plan: { blocks: [{ id: "b1", op: "keep" }], actionItems: [] },
      verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
      snapshotAt: "2026-10-10T00:00:00.000Z",
    });
    // Preview never writes to the doc.
    expect(replaceCollabDocContent).not.toHaveBeenCalled();
    expect(forceSnapshot).not.toHaveBeenCalled();
  });

  it("preview surfaces the generation error (e.g. nothing transcribed)", async () => {
    vi.mocked(generateAndVerifyEnhancePlan).mockResolvedValue({
      ok: false,
      status: 400,
      error: "Nothing was transcribed.",
    } as never);
    await expect(enhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1" })).rejects.toMatchObject({
      status: 400,
      message: "Nothing was transcribed.",
    });
  });

  it("apply requires a stored preview to exist", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(recording({ notes: null }));
    await expect(
      enhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1", apply: true }),
    ).rejects.toMatchObject({ status: 400 });
    expect(forceSnapshot).not.toHaveBeenCalled();
  });

  it("apply refuses (409) when a newer preview landed after the one being applied", async () => {
    const stored = {
      plan: { blocks: [], actionItems: [] },
      verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
      snapshotAt: "2026-10-10T00:00:00.000Z",
      snapshot: [],
    };
    mockPrisma.meetingRecording.findUnique.mockImplementation((args: { select?: { notes?: boolean } }) => {
      if (args?.select?.notes) {
        // A newer preview (later snapshotAt) landed while this apply was computing.
        return Promise.resolve({ notes: { ...stored, snapshotAt: "2026-10-10T00:05:00.000Z" } });
      }
      return Promise.resolve(recording({ notes: stored }));
    });

    await expect(
      enhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1", apply: true }),
    ).rejects.toMatchObject({ status: 409 });

    expect(replaceCollabDocContent).not.toHaveBeenCalled();
    expect(mockPrisma.meetingRecording.update).not.toHaveBeenCalled();
  });

  it("apply merges, inserts the transcript toggle, and stamps enhancedAt/enhancedBy when not stale", async () => {
    const stored = {
      plan: { blocks: [], actionItems: [] },
      verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
      snapshotAt: "2026-10-10T00:00:00.000Z",
      snapshot: [],
    };
    mockPrisma.meetingRecording.findUnique.mockImplementation((args: { select?: { notes?: boolean } }) => {
      if (args?.select?.notes) return Promise.resolve({ notes: stored });
      return Promise.resolve(recording({ notes: stored }));
    });

    const result = await enhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1", apply: true });

    expect(forceSnapshot).toHaveBeenCalledWith(expect.anything(), "doc:p1:body", "Before enhance", ["u1"]);
    expect(replaceCollabDocContent).toHaveBeenCalledWith("doc:p1:body", [], "u1");
    expect(mockPrisma.meetingRecording.update).toHaveBeenCalledWith({
      where: { id: "rec1" },
      data: { enhancedAt: expect.any(Date), enhancedBy: "Ada Lovelace" },
    });
    expect(result).toMatchObject({ applied: true, enhancedBy: "Ada Lovelace" });
  });

  it("apply refuses (409) when a top-level block in the live doc carries a reserved mark", async () => {
    const stored = {
      plan: { blocks: [], actionItems: [] },
      verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
      snapshotAt: "2026-10-10T00:00:00.000Z",
      snapshot: [],
    };
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(recording({ notes: stored }));
    vi.mocked(readDocAsBlocks).mockResolvedValue([
      { id: "b1", type: "paragraph", props: { backgroundColor: ENHANCE_MARK_ADDED }, content: [], children: [] },
    ] as never);

    await expect(
      enhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1", apply: true }),
    ).rejects.toMatchObject({ status: 409, message: "Keep or revert the current changes first" });

    expect(forceSnapshot).not.toHaveBeenCalled();
    expect(replaceCollabDocContent).not.toHaveBeenCalled();
    expect(mockPrisma.meetingRecording.update).not.toHaveBeenCalled();
  });

  it("apply refuses (409) for an enhance-prior mark too", async () => {
    const stored = {
      plan: { blocks: [], actionItems: [] },
      verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
      snapshotAt: "2026-10-10T00:00:00.000Z",
      snapshot: [],
    };
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(recording({ notes: stored }));
    vi.mocked(readDocAsBlocks).mockResolvedValue([
      { id: "b1", type: "heading", props: { backgroundColor: ENHANCE_MARK_PRIOR }, content: [], children: [] },
    ] as never);

    await expect(
      enhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1", apply: true }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("apply 503s when the collab server isn't running in this process", async () => {
    vi.mocked(getCollabServer).mockReturnValue(null as never);
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(
      recording({
        notes: {
          plan: { blocks: [], actionItems: [] },
          verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
          snapshotAt: "2026-10-10T00:00:00.000Z",
          snapshot: [],
        },
      }),
    );
    await expect(
      enhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1", apply: true }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("apply hands the merge a speakerAt that only names assigned speakers, like the in-app chips", async () => {
    const stored = {
      plan: { blocks: [], actionItems: [] },
      verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
      snapshotAt: "2026-10-10T00:00:00.000Z",
      snapshot: [],
    };
    vi.mocked(storedLines).mockReturnValue([
      { at: 10, end: 14, text: "ship it", channel: "call", speaker: "call:1" },
      { at: 60, end: 64, text: "ok", channel: "call", speaker: "call:2" },
      { at: 120, end: 124, text: "me", channel: "mic", speaker: "mic:1" },
    ] as never);
    vi.mocked(resolveSpeakerNames).mockResolvedValue({ "call:1": "Maya Chen" });
    mockPrisma.meetingRecording.findUnique.mockImplementation((args: { select?: { notes?: boolean } }) => {
      if (args?.select?.notes) return Promise.resolve({ notes: stored });
      return Promise.resolve(recording({ notes: stored, speakers: { "call:1": "user-maya" } }));
    });

    await enhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1", apply: true });

    const ctx = vi.mocked(applyEnhanceOpsToDocBlocks).mock.calls[0]![2] as { speakerAt: (at: number) => string | null };
    expect(ctx.speakerAt(11)).toBe("Maya");
    expect(ctx.speakerAt(61)).toBeNull();
    expect(ctx.speakerAt(121)).toBeNull();
  });
});
